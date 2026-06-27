package config

import (
    "crypto/rand"
    "encoding/base64"
    "os"
    "strconv"
    "sync"
)

// Config holds all application configuration.
type Config struct {
    Port               string
    ScanTimeoutSeconds int
    WCAGLevel          string
    MaxConcurrentScans int
    JWTSecret          string
    AdminPassword      string  // separate password for the frontend admin panel
    NodeBin            string
    AxeRunnerScript    string
    AllowPrivateScans  bool
}

// global holds the runtime configuration and is accessed concurrently.
var (
    global *Config
    mu     sync.RWMutex
)

// InitGlobal stores the loaded configuration for runtime access.
func InitGlobal(c *Config) {
    mu.Lock()
    defer mu.Unlock()
    global = c
}

// GetSecret returns the current JWT secret in a thread‑safe manner.
func GetSecret() string {
    mu.RLock()
    defer mu.RUnlock()
    if global == nil {
        return ""
    }
    return global.JWTSecret
}

// GetAllowPrivateScans returns whether private IP/localhost scans are allowed.
func GetAllowPrivateScans() bool {
    mu.RLock()
    defer mu.RUnlock()
    if global == nil {
        return false
    }
    return global.AllowPrivateScans
}

// GetAdminPassword returns the admin panel password.
func GetAdminPassword() string {
    mu.RLock()
    defer mu.RUnlock()
    if global == nil {
        return ""
    }
    return global.AdminPassword
}

// SetSecret updates the JWT secret at runtime.
func SetSecret(newSecret string) {
    mu.Lock()
    defer mu.Unlock()
    if global == nil {
        // Should never happen, but guard against nil.
        global = &Config{}
    }
    global.JWTSecret = newSecret
}

// generateRandomSecret creates a cryptographically‑secure secret when none is provided.
func generateRandomSecret(n int) string {
    b := make([]byte, n)
    if _, err := rand.Read(b); err != nil {
        // Fallback to a static value (unlikely).
        return "fallback-static-secret-please-set-JWT_SECRET"
    }
    return base64.RawURLEncoding.EncodeToString(b)
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
    secret := getEnv("JWT_SECRET", "")
    if secret == "" {
        // Generate a random secret if none is supplied.
        secret = generateRandomSecret(32)
    }
    return &Config{
        Port:               getEnv("PORT", "8080"),
        ScanTimeoutSeconds: getEnvInt("SCAN_TIMEOUT_SECONDS", 30),
        WCAGLevel:          getEnv("WCAG_LEVEL", "AA"),
        MaxConcurrentScans: getEnvInt("MAX_CONCURRENT_SCANS", 5),
        JWTSecret:          secret,
        AdminPassword:      getEnv("ADMIN_PASSWORD", ""),
        NodeBin:            getEnv("NODE_BIN", "node"),
        AxeRunnerScript:    getEnv("AXE_RUNNER_SCRIPT", "scripts/axe_runner.js"),
        AllowPrivateScans:  getEnvBool("ALLOW_PRIVATE_SCANS", false),
    }
}

func getEnv(key, fallback string) string {
    if v := os.Getenv(key); v != "" {
        return v
    }
    return fallback
}

func getEnvInt(key string, fallback int) int {
    if v := os.Getenv(key); v != "" {
        if n, err := strconv.Atoi(v); err == nil {
            return n
        }
    }
    return fallback
}

func getEnvBool(key string, fallback bool) bool {
    if v := os.Getenv(key); v != "" {
        if b, err := strconv.ParseBool(v); err == nil {
            return b
        }
    }
    return fallback
}
