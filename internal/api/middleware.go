package api

import (
	"net/http"
	"time"

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

// rateLimitMiddleware limits each client IP to 60 requests per minute on the
// scan, report and lead endpoints. A multi-page scan alone makes 11 scan
// requests, so the limit leaves room for a few of those plus report downloads.
//
// The key is the client IP as reported by the reverse proxy (X-Forwarded-For),
// because behind a proxy every request shares the proxy's remote address.
func rateLimitMiddleware() func(http.Handler) http.Handler {
	return httprate.Limit(60, time.Minute,
		httprate.WithKeyFuncs(func(r *http.Request) (string, error) { return getClientIP(r), nil }),
		// JSON body (per openapi) so the web app and the extension can show the message.
		// httprate has already set the Retry-After header at this point.
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusTooManyRequests, "too many requests",
				"rate limit is 60 requests per minute per IP; retry after "+w.Header().Get("Retry-After")+" seconds")
		}),
	)
}
