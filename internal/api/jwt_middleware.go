package api

import (
    "encoding/json"
    "net/http"
    "strings"
    "github.com/webaccessibility/server/internal/config"
    "github.com/golang-jwt/jwt/v4"
)

// jwtAuthMiddleware validates JWT tokens on protected routes.
// It reads the secret from the runtime config (config.GetSecret()).
func jwtAuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
            unauthorized(w)
            return
        }
        tokenString := strings.TrimPrefix(authHeader, "Bearer ")
        secret := config.GetSecret()
        if secret == "" {
            // If secret is not set, reject all requests for safety.
            unauthorized(w)
            return
        }
        token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
            // Ensure the token method is HMAC.
            if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
                return nil, jwt.NewValidationError("unexpected signing method", jwt.ValidationErrorSignatureInvalid)
            }
            return []byte(secret), nil
        })
        if err != nil || !token.Valid {
            unauthorized(w)
            return
        }
        // Token is valid; proceed to the next handler.
        next.ServeHTTP(w, r)
    }
}

func unauthorized(w http.ResponseWriter) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusUnauthorized)
    _ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
}
