package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/webaccessibility/server/internal/api"
	"github.com/webaccessibility/server/internal/config"
	"github.com/webaccessibility/server/internal/coverage"
	"github.com/webaccessibility/server/internal/scanner"
	"go.uber.org/zap"
)

func main() {
	// Logger
	logger, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to init logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync() //nolint:errcheck

	// Config
	cfg := config.Load()
	// Initialise global config for runtime secret access
	config.InitGlobal(cfg)

	// Scanner
	axeRunner := scanner.NewAxeRunner(cfg.NodeBin, cfg.AxeRunnerScript)
	coveragePath := os.Getenv("WCAG_COVERAGE_REPORT")
	if coveragePath == "" {
		coveragePath = "wcag_coverage_report.xlsx"
	}
	coverageStore := coverage.NewStore(coveragePath)

	// Handler
	h := &api.Handler{
		Scanner:     axeRunner,
		Logger:      logger,
		WCAGLevel:   cfg.WCAGLevel,
		ScanTimeout: time.Duration(cfg.ScanTimeoutSeconds) * time.Second,
		Coverage:    coverageStore,
	}

	// Router
	router := api.NewRouter(h, logger)

	// HTTP Server
	port, err := strconv.Atoi(cfg.Port)
	if err != nil {
		logger.Fatal("invalid port configuration", zap.Error(err))
	}

	var listener net.Listener
	for i := 0; i < 5; i++ {
		addr := fmt.Sprintf(":%d", port+i)
		listener, err = net.Listen("tcp", addr)
		if err == nil {
			logger.Info("server bound to port", zap.Int("port", port+i))
			break
		}
		logger.Warn("failed to bind to port, trying next", zap.Int("port", port+i), zap.Error(err))
	}

	if err != nil {
		logger.Fatal("could not bind to any port", zap.Error(err))
	}

	srv := &http.Server{
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: time.Duration(cfg.ScanTimeoutSeconds+10) * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in background
	go func() {
		logger.Info("server starting", zap.String("addr", listener.Addr().String()))
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	// Graceful shutdown on SIGINT/SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("server forced shutdown", zap.Error(err))
	}
	logger.Info("server stopped")
}
