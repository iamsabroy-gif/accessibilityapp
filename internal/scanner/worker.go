package scanner

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync"
)

// errWorkerUnavailable means the persistent scan worker could not be used
// (failed to start, or died mid-scan). Callers fall back to a one-shot process.
var errWorkerUnavailable = errors.New("scan worker unavailable")

type workerResponse struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// nodeWorker manages one long-lived scripts/scan_worker.js process, which keeps
// a headless browser open across scans. Scans are multiplexed over the
// process's stdin/stdout as JSON lines.
type nodeWorker struct {
	nodeBin    string
	scriptPath string

	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	pending map[string]chan workerResponse
	nextID  uint64
	closed  bool
}

func newNodeWorker(nodeBin, scriptPath string) *nodeWorker {
	return &nodeWorker{nodeBin: nodeBin, scriptPath: scriptPath}
}

// startLocked launches the worker process if it is not running. Caller holds w.mu.
func (w *nodeWorker) startLocked() error {
	if w.cmd != nil {
		return nil
	}
	if w.closed {
		return errWorkerUnavailable
	}
	cmd := exec.Command(w.nodeBin, w.scriptPath)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	w.cmd = cmd
	w.stdin = stdin
	w.pending = make(map[string]chan workerResponse)
	go w.readLoop(cmd, stdout)
	return nil
}

// readLoop dispatches worker output to waiting scans until the process exits.
func (w *nodeWorker) readLoop(cmd *exec.Cmd, stdout io.Reader) {
	reader := bufio.NewReaderSize(stdout, 1<<20)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			var resp workerResponse
			if json.Unmarshal(line, &resp) == nil && resp.ID != "" {
				w.mu.Lock()
				ch := w.pending[resp.ID]
				delete(w.pending, resp.ID)
				w.mu.Unlock()
				if ch != nil {
					ch <- resp
				}
			}
		}
		if err != nil {
			break
		}
	}
	_ = cmd.Wait()

	// The process is gone: release every scan still waiting on it.
	w.mu.Lock()
	if w.cmd == cmd {
		for id, ch := range w.pending {
			close(ch)
			delete(w.pending, id)
		}
		w.cmd = nil
		w.stdin = nil
	}
	w.mu.Unlock()
}

// Scan runs one scan on the worker and returns the raw JSON result.
func (w *nodeWorker) Scan(ctx context.Context, url string) ([]byte, error) {
	w.mu.Lock()
	if err := w.startLocked(); err != nil {
		w.mu.Unlock()
		return nil, fmt.Errorf("%w: %v", errWorkerUnavailable, err)
	}
	w.nextID++
	id := strconv.FormatUint(w.nextID, 10)
	ch := make(chan workerResponse, 1)
	w.pending[id] = ch
	req, _ := json.Marshal(map[string]string{"id": id, "url": url})
	_, err := w.stdin.Write(append(req, '\n'))
	if err != nil {
		delete(w.pending, id)
	}
	w.mu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errWorkerUnavailable, err)
	}

	select {
	case resp, ok := <-ch:
		if !ok {
			return nil, fmt.Errorf("%w: process exited during scan", errWorkerUnavailable)
		}
		if resp.Error != "" {
			return nil, errors.New(resp.Error)
		}
		return resp.Result, nil
	case <-ctx.Done():
		// Tell the worker to abandon the page so it stops using CPU and memory.
		w.mu.Lock()
		delete(w.pending, id)
		if w.stdin != nil {
			cancel, _ := json.Marshal(map[string]interface{}{"id": id, "cancel": true})
			_, _ = w.stdin.Write(append(cancel, '\n'))
		}
		w.mu.Unlock()
		return nil, ctx.Err()
	}
}

// Close stops the worker process. Closing stdin lets it shut its browser down cleanly.
func (w *nodeWorker) Close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closed = true
	if w.stdin != nil {
		_ = w.stdin.Close()
	}
}
