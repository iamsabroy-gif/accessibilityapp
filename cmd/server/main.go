package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/webaccessibility/server/internal/api"
	"github.com/webaccessibility/server/internal/config"
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

	// Scanner
	axeRunner := scanner.NewAxeRunner(cfg.NodeBin, cfg.AxeRunnerScript)

	// Handler
	h := &api.Handler{
		Scanner:     axeRunner,
		Logger:      logger,
		WCAGLevel:   cfg.WCAGLevel,
		ScanTimeout: time.Duration(cfg.ScanTimeoutSeconds) * time.Second,
	}

	// Router
	router := api.NewRouter(h, logger)

	// HTTP Server
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: time.Duration(cfg.ScanTimeoutSeconds+10) * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in background
	go func() {
		logger.Info("server starting", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
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
