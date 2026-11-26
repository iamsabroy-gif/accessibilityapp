package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/webaccessibility/server/internal/config"
	"go.uber.org/zap"
)

// NewRouter wires up all routes and middleware.
func NewRouter(h *Handler, logger *zap.Logger) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware
	r.Use(corsMiddleware)
	r.Use(middleware.Compress(5))
	r.Use(loggingMiddleware(logger))

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/", h.Info)
		r.Get("/health", h.Health)
		r.Get("/session", h.Session)                   // public: auto-issues JWT to any visitor
		r.Post("/admin/verify", h.VerifyAdminPassword) // public: verifies admin password
		r.Get("/report/*", h.GetReport)                // public: fetch cached extension scan results
		r.Post("/admin/coverage", adminAuthMiddleware(h.UploadCoverageReport))
		r.Get("/admin/settings", adminAuthMiddleware(h.GetSettings))
		r.Post("/admin/settings", adminAuthMiddleware(h.UpdateSettings))
		r.Get("/admin/activity", adminAuthMiddleware(h.GetActivity))
		r.Get("/admin/access", adminAuthMiddleware(h.ListAccess))
		r.Post("/admin/access/{id}/{action}", adminAuthMiddleware(h.AdminDecideAccess))
		r.Get("/access/review", h.ReviewAccess) // owner's emailed review link (guarded by its key)
		r.Get("/coverage", h.CoverageReport)
		r.Get("/crawl/{id}", h.GetCrawl)                  // public: progress of a multi-page scan (polled)
		r.Post("/crawl/{id}/cancel", h.CancelCrawl)       // public: stop a multi-page scan
		r.Post("/token", h.GenerateToken)                 // public
		r.Post("/secret", jwtAuthMiddleware(h.SetSecret)) // protected: change secret
		r.Get("/secret", jwtAuthMiddleware(h.GetSecret))  // protected: retrieve secret (dev/ops only)

		// Rate-limit the expensive scan/score endpoints & public lead capture
		r.Group(func(r chi.Router) {
			r.Use(rateLimitMiddleware())
			r.Post("/leads", h.CaptureLead)            // public + rate-limited
			r.Post("/visit", h.CaptureVisit)           // public + rate-limited
			r.Post("/access/request", h.RequestAccess) // returning user asks for access
			r.Post("/access/session", h.AccessSession) // access code → scan token
			r.Post("/access/review", h.DecideAccess)   // owner approves/denies
			// Scan routes count scans made with an access-code token (see access.go).
			r.Post("/scan", h.meteredAuth(h.Scan))
			r.Post("/crawl", h.meteredAuth(h.StartCrawl))
			r.Post("/scan/client", h.meteredAuth(h.ScanClient))
			r.Post("/score", jwtAuthMiddleware(h.ScoreOnly))
			for name := range reportSpecs {
				r.Post("/report/"+name, jwtAuthMiddleware(h.Report(name)))
			}
		})
	})

	// Frontend static files — serve from ./frontend relative to cwd.
	// Falls back to index.html for unknown paths (SPA behaviour).
	frontendDir := frontendPath()
	fs := http.FileServer(http.Dir(frontendDir))

	// Landing page at root (feature-flagged)
	r.Get("/", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		if config.GetLandingPageEnabled() {
			landingFile := filepath.Join(frontendDir, "landing.html")
			if !config.GetLeadCaptureEnabled() {
				content, err := os.ReadFile(landingFile)
				if err == nil {
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
					htmlStr := strings.Replace(string(content), `name="lead-capture-enabled" content="true"`, `name="lead-capture-enabled" content="false"`, 1)
					w.Write([]byte(htmlStr))
					return
				}
			}
			http.ServeFile(w, req, landingFile)
			return
		}
		http.ServeFile(w, req, filepath.Join(frontendDir, "index.html"))
	})

	// Static files and the app/admin pages may be cached, but the browser must
	// revalidate on every use: unchanged files then cost a 304 instead of a full
	// download, and a new deploy is still picked up immediately.
	// (The root page above stays uncached because its content depends on a setting.)
	const revalidate = "no-cache"

	// Scan tool now lives explicitly at /app
	r.Get("/app", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Cache-Control", revalidate)
		http.ServeFile(w, req, filepath.Join(frontendDir, "index.html"))
	})

	// Admin console lives at /admin
	r.Get("/admin", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Cache-Control", revalidate)
		http.ServeFile(w, req, filepath.Join(frontendDir, "admin.html"))
	})

	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		// If the file exists on disk, serve it directly.
		// Otherwise serve index.html so client-side routing works.
		path := filepath.Join(frontendDir, filepath.Clean("/"+req.URL.Path))
		w.Header().Set("Cache-Control", revalidate)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, req)
			return
		}
		http.ServeFile(w, req, filepath.Join(frontendDir, "index.html"))
	})

	return r
}

// frontendPath returns the path to the frontend directory.
// Checks FRONTEND_DIR env var first, then falls back to "./frontend".
func frontendPath() string {
	if dir := os.Getenv("FRONTEND_DIR"); dir != "" {
		return dir
	}
	return "./frontend"
}
