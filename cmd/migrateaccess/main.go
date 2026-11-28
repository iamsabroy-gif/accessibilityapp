// Command migrateaccess idempotently imports data/access.json into MongoDB.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/webaccessibility/server/internal/access"
	"github.com/webaccessibility/server/internal/config"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func main() {
	cfg := config.Load()

	accessPath := flag.String("access", cfg.AccessStorePath, "path to access.json")
	uri := flag.String("uri", cfg.MongoDBURI, "MongoDB connection URI (defaults to MONGODB_URI)")
	dbName := flag.String("db", cfg.MongoDBDB, "MongoDB database name (defaults to MONGODB_DB)")
	dryRun := flag.Bool("dry-run", false, "print counts without writing to MongoDB")
	flag.Parse()

	reqs, err := loadRequests(*accessPath)
	if err != nil {
		log.Fatalf("load %s: %v", *accessPath, err)
	}

	if *dryRun {
		fmt.Printf("dry-run: %d access requests (%s)\n", len(reqs), *accessPath)
		return
	}

	if *uri == "" {
		log.Fatal("MONGODB_URI is required (pass -uri or set MONGODB_URI)")
	}
	if *dbName == "" {
		*dbName = "accessscan"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Ensure indexes via NewMongoStore first, then disconnect or reuse client.
	store, err := access.NewMongoStore(ctx, *uri, *dbName)
	if err != nil {
		log.Fatalf("connect mongodb: %v", err)
	}
	_ = store.Close(ctx)

	client, err := mongo.Connect(options.Client().ApplyURI(*uri).SetMaxPoolSize(10))
	if err != nil {
		log.Fatalf("connect mongodb: %v", err)
	}
	defer func() { _ = client.Disconnect(context.Background()) }()

	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		log.Fatalf("ping mongodb: %v", err)
	}

	db := client.Database(*dbName)
	reqCol := db.Collection("access_requests")

	reqUpserted, reqMatched := 0, 0
	for _, r := range reqs {
		res, err := reqCol.UpdateOne(
			ctx,
			bson.D{{Key: "_id", Value: r.ID}},
			bson.D{{Key: "$setOnInsert", Value: r}},
			options.UpdateOne().SetUpsert(true),
		)
		if err != nil {
			log.Fatalf("upsert request %s: %v", r.ID, err)
		}
		if res.UpsertedCount > 0 {
			reqUpserted++
		} else if res.MatchedCount > 0 {
			reqMatched++
		}
	}

	fmt.Printf("migrated access_requests: %d inserted, %d already present (total %d)\n",
		reqUpserted, reqMatched, len(reqs))
}

func loadRequests(path string) ([]*access.Request, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return nil, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		var list []*access.Request
		if err := json.Unmarshal(data, &list); err != nil {
			return nil, err
		}
		return list, nil
	}
	var snap struct {
		Requests []*access.Request `json:"requests"`
	}
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, err
	}
	return snap.Requests, nil
}
