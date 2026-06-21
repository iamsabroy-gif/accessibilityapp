package scanner

import (
	"context"

	"github.com/webaccessibility/server/internal/models"
)

// Scanner defines the interface for any accessibility scanning backend.
type Scanner interface {
	Scan(ctx context.Context, url string, wcagLevel string) (*models.ScanResult, error)
}
