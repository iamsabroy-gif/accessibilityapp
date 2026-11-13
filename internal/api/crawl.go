package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/models"
	"github.com/webaccessibility/server/internal/scoring"
	"go.uber.org/zap"
)

// A crawl is a multi-page scan that runs on the server: the start page is
// scanned, same-site pages linked from it are selected, and each of those is
// scanned in turn. The browser only polls for progress, so closing or
// reloading the tab does not lose the scan.

const (
	crawlTTL      = 2 * time.Hour
	crawlMaxJobs  = 200
	crawlMaxPages = 10

	crawlScanningMain  = "scanning_main"
	crawlScanningPages = "scanning_pages"
	crawlDone          = "done"
	crawlError         = "error"
	crawlCancelled     = "cancelled"

	pageQueued   = "queued"
	pageScanning = "scanning"
	pageDone     = "done"
	pageError    = "error"
	pageTimeout  = "timeout"
)

// crawlPage is the state of one linked page within a crawl.
type crawlPage struct {
	URL    string `json:"url"`
	Status string `json:"status"`
	ScanID string `json:"scan_id,omitempty"`
	Error  string `json:"error,omitempty"`
}

// crawlSnapshot is the JSON view of a crawl returned to clients.
type crawlSnapshot struct {
	CrawlID    string      `json:"crawl_id"`
	URL        string      `json:"url"`
	Status     string      `json:"status"`
	MainScanID string      `json:"main_scan_id,omitempty"`
	Error      string      `json:"error,omitempty"`
	Pages      []crawlPage `json:"pages"`
	Finished   int         `json:"finished"` // linked pages that are done, failed or timed out
	Total      int         `json:"total"`    // linked pages selected for scanning
}

type crawlJob struct {
	mu        sync.Mutex
	snap      crawlSnapshot
	createdAt time.Time
	cancel    context.CancelFunc
}

func (j *crawlJob) snapshot() crawlSnapshot {
	j.mu.Lock()
	defer j.mu.Unlock()
	s := j.snap
	s.Pages = append([]crawlPage{}, j.snap.Pages...)
	s.Total = len(s.Pages)
	for _, p := range s.Pages {
		if p.Status != pageQueued && p.Status != pageScanning {
			s.Finished++
		}
	}
	return s
}

func (j *crawlJob) update(fn func(s *crawlSnapshot)) {
	j.mu.Lock()
	fn(&j.snap)
	j.mu.Unlock()
}

// crawlStore holds crawl jobs in memory. Page results themselves live in the
// ResultStore; only progress is kept here.
type crawlStore struct {
	mu   sync.Mutex
	jobs map[string]*crawlJob
}

func (s *crawlStore) add(job *crawlJob) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jobs == nil {
		s.jobs = make(map[string]*crawlJob)
	}
	now := time.Now()
	for id, j := range s.jobs {
		if now.Sub(j.createdAt) > crawlTTL {
			j.cancel()
			delete(s.jobs, id)
		}
	}
	for len(s.jobs) >= crawlMaxJobs {
		var oldest string
		for id, j := range s.jobs {
			if oldest == "" || j.createdAt.Before(s.jobs[oldest].createdAt) {
				oldest = id
			}
		}
		s.jobs[oldest].cancel()
		delete(s.jobs, oldest)
	}
	s.jobs[job.snap.CrawlID] = job
}

func (s *crawlStore) get(id string) (*crawlJob, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.jobs[id]
	if ok && time.Since(j.createdAt) > crawlTTL {
		return nil, false
	}
	return j, ok
}

// StartCrawl handles POST /api/v1/crawl. It starts a multi-page scan in the
// background and returns its ID immediately.
func (h *Handler) StartCrawl(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
		// Parallel scans linked pages concurrently, up to the server's
		// concurrent-scan limit. Otherwise they are scanned one at a time.
		Parallel bool `json:"parallel"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body", err.Error())
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required", "")
		return
	}
	if err := validateURL(req.URL); err != nil {
		writeError(w, http.StatusBadRequest, "invalid url", err.Error())
		return
	}
	if isPrivateURL(req.URL) && !config.GetAllowPrivateScans() {
		writeError(w, http.StatusForbidden, "scanning private/internal addresses is not allowed", "")
		return
	}

	b := make([]byte, 12)
	_, _ = rand.Read(b)
	// The whole crawl is bounded: one scan timeout per page, plus the start page.
	ctx, cancel := context.WithTimeout(context.Background(), h.ScanTimeout*time.Duration(crawlMaxPages+2))
	job := &crawlJob{
		snap:      crawlSnapshot{CrawlID: hex.EncodeToString(b), URL: req.URL, Status: crawlScanningMain},
		createdAt: time.Now(),
		cancel:    cancel,
	}
	h.crawls.add(job)
	go h.runCrawl(ctx, job, req.Parallel)

	writeJSON(w, http.StatusAccepted, job.snapshot())
}

// scanForCrawl scans one page within a crawl, waiting for a scan slot first.
func (h *Handler) scanForCrawl(ctx context.Context, url string, depth int) (*models.ScanResult, error) {
	ctx, cancel := context.WithTimeout(ctx, h.ScanTimeout)
	defer cancel()
	if err := h.acquireSlot(ctx); err != nil {
		return nil, err
	}
	defer h.releaseSlot()
	result, err := h.Scanner.Scan(ctx, url, "AAA", depth)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	result.ScanID = h.results().Save(result)
	return result, nil
}

func (h *Handler) runCrawl(ctx context.Context, job *crawlJob, parallel bool) {
	defer job.cancel()
	id, url := job.snap.CrawlID, job.snap.URL

	// finish records the final status unless the crawl was cancelled meanwhile.
	finish := func(status, errMsg string) {
		job.update(func(s *crawlSnapshot) {
			if s.Status != crawlCancelled {
				s.Status, s.Error = status, errMsg
			}
		})
	}

	h.Logger.Info("starting crawl", zap.String("crawl_id", id), zap.String("url", url), zap.Bool("parallel", parallel))
	main, err := h.scanForCrawl(ctx, url, 1)
	if err != nil {
		h.Logger.Error("crawl start page failed", zap.String("crawl_id", id), zap.Error(err))
		finish(crawlError, err.Error())
		return
	}

	links := main.DiscoveredLinks
	if len(links) > crawlMaxPages {
		links = links[:crawlMaxPages]
	}
	job.update(func(s *crawlSnapshot) {
		s.MainScanID = main.ScanID
		for _, l := range links {
			s.Pages = append(s.Pages, crawlPage{URL: l, Status: pageQueued})
		}
		if s.Status != crawlCancelled {
			s.Status = crawlScanningPages
		}
	})

	workers := 1
	if parallel {
		workers = config.GetMaxConcurrentScans()
	}
	if workers > len(links) {
		workers = len(links)
	}

	next := make(chan int)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				if ctx.Err() != nil {
					continue
				}
				job.update(func(s *crawlSnapshot) { s.Pages[i].Status = pageScanning })
				res, err := h.scanForCrawl(ctx, links[i], 0)
				job.update(func(s *crawlSnapshot) {
					p := &s.Pages[i]
					switch {
					case err == nil:
						p.Status, p.ScanID = pageDone, res.ScanID
					case errors.Is(err, context.DeadlineExceeded):
						p.Status, p.Error = pageTimeout, "scan timed out"
					default:
						p.Status, p.Error = pageError, err.Error()
					}
				})
			}
		}()
	}
	for i := range links {
		next <- i
	}
	close(next)
	wg.Wait()

	// Pages never started (crawl cancelled or out of time) must not stay "queued".
	job.update(func(s *crawlSnapshot) {
		for i := range s.Pages {
			if s.Pages[i].Status == pageQueued || s.Pages[i].Status == pageScanning {
				s.Pages[i].Status, s.Pages[i].Error = pageError, "scan was not run"
			}
		}
	})
	finish(crawlDone, "")
	h.Logger.Info("crawl finished", zap.String("crawl_id", id), zap.Int("pages", len(links)))
}

// GetCrawl handles GET /api/v1/crawl/{id}: progress of a crawl. Page results
// are fetched separately by scan_id from GET /api/v1/report/{scan_id}.
func (h *Handler) GetCrawl(w http.ResponseWriter, r *http.Request) {
	job, ok := h.crawls.get(chi.URLParam(r, "id"))
	if !ok {
		writeError(w, http.StatusNotFound, "crawl not found or expired", "")
		return
	}
	writeJSON(w, http.StatusOK, job.snapshot())
}

// CancelCrawl handles POST /api/v1/crawl/{id}/cancel: stops scanning further pages.
func (h *Handler) CancelCrawl(w http.ResponseWriter, r *http.Request) {
	job, ok := h.crawls.get(chi.URLParam(r, "id"))
	if !ok {
		writeError(w, http.StatusNotFound, "crawl not found or expired", "")
		return
	}
	job.update(func(s *crawlSnapshot) {
		if s.Status == crawlScanningMain || s.Status == crawlScanningPages {
			s.Status = crawlCancelled
		}
	})
	job.cancel()
	writeJSON(w, http.StatusOK, job.snapshot())
}

// crawlResult returns one combined result covering the start page and every
// linked page of a crawl that was scanned successfully.
func (h *Handler) crawlResult(crawlID string) (*models.ScanResult, bool) {
	job, ok := h.crawls.get(crawlID)
	if !ok {
		return nil, false
	}
	snap := job.snapshot()
	ids := []string{snap.MainScanID}
	for _, p := range snap.Pages {
		if p.Status == pageDone {
			ids = append(ids, p.ScanID)
		}
	}
	var results []*models.ScanResult
	for _, id := range ids {
		if res, ok := h.results().Get(id); ok {
			results = append(results, res)
		}
	}
	if snap.MainScanID == "" || len(results) == 0 || results[0].URL == "" {
		return nil, false
	}
	return aggregateResults(results), true
}

// aggregateResults merges per-page results into one site-level result.
// Violations of the same rule are combined (their failing elements are pooled),
// and tested-element counts of passing rules are summed, so per-criterion
// failure rates in compliance reports reflect every page. results[0] is the
// start page and supplies the URL and scan time.
func aggregateResults(results []*models.ScanResult) *models.ScanResult {
	first := results[0]
	out := &models.ScanResult{URL: first.URL, ScannedAt: first.ScannedAt}

	violIndex := map[string]int{}
	passIndex := map[string]int{}
	incompleteSeen := map[string]bool{}
	for _, res := range results {
		out.PagesScanned = append(out.PagesScanned, res.URL)
		out.DurationMs += res.DurationMs
		for _, v := range res.Violations {
			if i, ok := violIndex[v.ID]; ok {
				out.Violations[i].Nodes = append(out.Violations[i].Nodes, v.Nodes...)
				continue
			}
			violIndex[v.ID] = len(out.Violations)
			merged := v
			merged.Nodes = append([]models.Node{}, v.Nodes...)
			out.Violations = append(out.Violations, merged)
		}
		for _, p := range res.PassRules {
			if i, ok := passIndex[p.ID]; ok {
				out.PassRules[i].NodeCount += p.NodeCount
				continue
			}
			passIndex[p.ID] = len(out.PassRules)
			out.PassRules = append(out.PassRules, p)
			out.Passes = append(out.Passes, p.ID)
		}
		for _, id := range res.Incomplete {
			if !incompleteSeen[id] {
				incompleteSeen[id] = true
				out.Incomplete = append(out.Incomplete, id)
			}
		}
	}

	score, grade, pct := scoring.Calculate(out.Violations, len(out.Passes), len(out.Incomplete), config.GetScoringFormula())
	ae := scoring.CalculateAudioEye(out.Violations, out.PassRules, models.WCAGMap)
	out.AudioEye = &ae
	out.Summary = models.Summary{
		ViolationCount:  len(out.Violations),
		PassCount:       len(out.Passes),
		IncompleteCount: len(out.Incomplete),
		Level:           first.Summary.Level,
		Score:           score,
		Grade:           grade,
		CompliancePct:   pct,
		AudioEyeScore:   ae.Score,
	}
	return out
}
