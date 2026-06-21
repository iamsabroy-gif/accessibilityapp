package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/httprate"
	"go.uber.org/zap"
)

// loggingMiddleware logs each incoming request and its response status.
func loggingMiddleware(logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			lrw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(lrw, r)
			logger.Info("request",
				zap.String("method", r.Method),
				zap.String("path", r.URL.Path),
				zap.Int("status", lrw.status),
				zap.String("remote", r.RemoteAddr),
			)
		})
	}
}

// loggingResponseWriter captures the status code for logging.
type loggingResponseWriter struct {
	http.ResponseWriter
	status int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.status = code
	lrw.ResponseWriter.WriteHeader(code)
}

// corsMiddleware adds permissive CORS headers for local/API usage.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// rateLimitMiddleware limits each IP to 10 requests per minute.
func rateLimitMiddleware() func(http.Handler) http.Handler {
	return httprate.LimitByIP(10, 1) // 10 req per 1 minute
}

// ssrfGuard rejects requests to private/internal IP ranges to prevent SSRF.
func ssrfGuard(next http.Handler) http.Handler {
	blocked := []string{
		"localhost", "127.", "10.", "192.168.", "172.16.", "172.17.",
		"172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
		"172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
		"172.30.", "172.31.", "::1", "0.0.0.0",
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if targetURL := r.Header.Get("X-Scan-URL"); targetURL != "" {
			lower := strings.ToLower(targetURL)
			for _, b := range blocked {
				if strings.Contains(lower, b) {
					http.Error(w, `{"error":"scanning private/internal addresses is not allowed"}`, http.StatusForbidden)
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
