package api

import (
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// NewRouter wires up all routes and middleware.
func NewRouter(h *Handler, logger *zap.Logger) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware
	r.Use(corsMiddleware)
	r.Use(loggingMiddleware(logger))
	r.Use(rateLimitMiddleware())

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/", h.Info)
		r.Get("/health", h.Health)
		r.Post("/scan", jwtAuthMiddleware(h.Scan))
		r.Post("/score", jwtAuthMiddleware(h.ScoreOnly))
		r.Post("/token", h.GenerateToken)
	})

	return r
}
