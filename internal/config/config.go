package config

import (
	"os"
	"strconv"
)

// Config holds all application configuration.
type Config struct {
	Port                string
	ScanTimeoutSeconds  int
	WCAGLevel           string
	MaxConcurrentScans  int
	JWTSecret           string
	NodeBin             string
	AxeRunnerScript     string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:               getEnv("PORT", "8080"),
		ScanTimeoutSeconds: getEnvInt("SCAN_TIMEOUT_SECONDS", 30),
		WCAGLevel:          getEnv("WCAG_LEVEL", "AA"),
		MaxConcurrentScans: getEnvInt("MAX_CONCURRENT_SCANS", 5),
		JWTSecret:          getEnv("JWT_SECRET", ""),
		NodeBin:            getEnv("NODE_BIN", "node"),
		AxeRunnerScript:    getEnv("AXE_RUNNER_SCRIPT", "scripts/axe_runner.js"),
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
