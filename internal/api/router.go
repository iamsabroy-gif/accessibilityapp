package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// NewRouter wires up all routes and middleware.
func NewRouter(h *Handler, logger *zap.Logger) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware
	r.Use(corsMiddleware)
	r.Use(loggingMiddleware(logger))

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/", h.Info)
		r.Get("/health", h.Health)
		r.Get("/session", h.Session)                   // public: auto-issues JWT to any visitor
		r.Post("/admin/verify", h.VerifyAdminPassword) // public: verifies admin password
		r.Post("/admin/coverage", adminAuthMiddleware(h.UploadCoverageReport))
		r.Get("/admin/settings", adminAuthMiddleware(h.GetSettings))
		r.Post("/admin/settings", adminAuthMiddleware(h.UpdateSettings))
		r.Get("/coverage", h.CoverageReport)
		r.Post("/token", h.GenerateToken)                 // public
		r.Post("/secret", jwtAuthMiddleware(h.SetSecret)) // protected: change secret
		r.Get("/secret", jwtAuthMiddleware(h.GetSecret))  // protected: retrieve secret (dev/ops only)

		// Rate-limit the expensive scan/score endpoints
		r.Group(func(r chi.Router) {
			r.Use(rateLimitMiddleware())
			r.Post("/scan", jwtAuthMiddleware(h.Scan))
			r.Post("/score", jwtAuthMiddleware(h.ScoreOnly))
		})
	})

	// Frontend static files — serve from ./frontend relative to cwd.
	// Falls back to index.html for unknown paths (SPA behaviour).
	frontendDir := frontendPath()
	fs := http.FileServer(http.Dir(frontendDir))

	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		// If the file exists on disk, serve it directly.
		// Otherwise serve index.html so client-side routing works.
		path := filepath.Join(frontendDir, filepath.Clean("/"+req.URL.Path))
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
