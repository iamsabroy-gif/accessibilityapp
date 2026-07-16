package config

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"os"
	"strconv"
	"strings"
	"sync"
)

// Config holds all application configuration.
type Config struct {
	Port               string
	ScanTimeoutSeconds int
	WCAGLevel          string
	MaxConcurrentScans int
	JWTSecret          string
	AdminPassword      string // separate password for the frontend admin panel
	NodeBin            string
	AxeRunnerScript    string
	NativeRunnerScript string
	AllowPrivateScans  bool
	// ScoringFormula controls how the 0-100 score is computed.
	// "compliance" (default) = round(passCount / total * 100)
	// "penalty"              = max(0, 100 - Σ impactPenalty)
	ScoringFormula     string
	ActiveEngine       string // "axe" or "native"
	// PDFScanningVisible controls whether the "PDF scanning — coming soon" UI card
	// is revealed in the main app. This is a UI-visibility flag ONLY — it must
	// NEVER be used to gate actual PDF scan processing (use PDFScanningEnabled
	// for that when Phase 1 is greenlit).
	PDFScanningVisible bool
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

// GetMaxConcurrentScans returns the max concurrent scans allowed.
func GetMaxConcurrentScans() int {
	mu.RLock()
	defer mu.RUnlock()
	if global == nil {
		return 5
	}
	return global.MaxConcurrentScans
}

// SetMaxConcurrentScans updates the max concurrent scans limit.
func SetMaxConcurrentScans(n int) {
	mu.Lock()
	defer mu.Unlock()
	if global != nil && n > 0 {
		global.MaxConcurrentScans = n
	}
}

// GetScoringFormula returns the active scoring formula ("compliance" or "penalty").
func GetScoringFormula() string {
	mu.RLock()
	defer mu.RUnlock()
	if global == nil || global.ScoringFormula == "" {
		return "compliance"
	}
	return global.ScoringFormula
}

// GetWCAGLevel returns the configured WCAG scan level (default "AA").
// This is loaded from the WCAG_LEVEL environment variable.
func GetWCAGLevel() string {
	mu.RLock()
	defer mu.RUnlock()
	if global == nil || global.WCAGLevel == "" {
		return "AA"
	}
	return global.WCAGLevel
}

// SetScoringFormula updates the scoring formula at runtime.
// Accepted values: "compliance", "penalty". Unknown values are ignored.
func SetScoringFormula(f string) {
	if f != "compliance" && f != "penalty" {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	if global == nil {
		global = &Config{}
	}
	global.ScoringFormula = f
}

// GetActiveEngine returns the currently active engine ("axe" or "native").
func GetActiveEngine() string {
	mu.RLock()
	defer mu.RUnlock()
	if global == nil || global.ActiveEngine == "" {
		return "native"
	}
	return global.ActiveEngine
}

// SetActiveEngine updates the active engine at runtime.
func SetActiveEngine(e string) {
	if e != "axe" && e != "native" {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	if global == nil {
		global = &Config{}
	}
	global.ActiveEngine = e
}

// GetPDFScanningVisible returns whether the PDF scanning coming-soon UI card is visible.
// UI-only flag — MUST NOT be used to gate actual PDF scan processing.
func GetPDFScanningVisible() bool {
	mu.RLock()
	defer mu.RUnlock()
	if global == nil {
		return false
	}
	return global.PDFScanningVisible
}

// SetPDFScanningVisible toggles the PDF scanning UI visibility at runtime.
// UI-only flag — MUST NOT be used to gate actual PDF scan processing.
func SetPDFScanningVisible(v bool) {
	mu.Lock()
	defer mu.Unlock()
	if global == nil {
		global = &Config{}
	}
	global.PDFScanningVisible = v
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
	loadDotEnv()
	secret := getEnv("JWT_SECRET", "")
	if secret == "" {
		// Generate a random secret if none is supplied.
		secret = generateRandomSecret(32)
	}
	formula := getEnv("SCORING_FORMULA", "compliance")
	if formula != "compliance" && formula != "penalty" {
		formula = "compliance"
	}
	return &Config{
		Port:               getEnv("PORT", "8080"),
		ScanTimeoutSeconds: getEnvInt("SCAN_TIMEOUT_SECONDS", 180),
		WCAGLevel:          getEnv("WCAG_LEVEL", "AA"),
		MaxConcurrentScans: getEnvInt("MAX_CONCURRENT_SCANS", 5),
		JWTSecret:          secret,
		AdminPassword:      getEnv("ADMIN_PASSWORD", ""),
		NodeBin:            getEnv("NODE_BIN", "node"),
		AxeRunnerScript:    getEnv("AXE_RUNNER_SCRIPT", "scripts/axe_runner.js"),
		NativeRunnerScript: getEnv("NATIVE_RUNNER_SCRIPT", "scripts/native_runner.js"),
		AllowPrivateScans:   getEnvBool("ALLOW_PRIVATE_SCANS", false),
		ScoringFormula:      formula,
		ActiveEngine:        getEnv("ACTIVE_ENGINE", "native"),
		PDFScanningVisible:  getEnvBool("PDF_SCANNING_VISIBLE", false),
	}
}

func loadDotEnv() {
	file, err := os.Open(".env")
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			val := strings.TrimSpace(parts[1])
			if (strings.HasPrefix(val, "\"") && strings.HasSuffix(val, "\"")) ||
				(strings.HasPrefix(val, "'") && strings.HasSuffix(val, "'")) {
				val = val[1 : len(val)-1]
			}
			if os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
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
