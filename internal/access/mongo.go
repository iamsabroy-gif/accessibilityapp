package access

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

const opTimeout = 10 * time.Second

// MongoStore persists access requests, users and login codes in MongoDB.
type MongoStore struct {
	client     *mongo.Client
	db         *mongo.Database
	users      *mongo.Collection
	loginCodes *mongo.Collection
	requests   *mongo.Collection
	now        func() time.Time
}

type mongoUser struct {
	ID           bson.ObjectID `bson:"_id"`
	Email        string        `bson:"email"`
	ScansAllowed int           `bson:"scans_allowed"`
	ScansUsed    int           `bson:"scans_used"`
	Status       string        `bson:"status"`
	CreatedAt    time.Time     `bson:"created_at"`
	LastLoginAt  *time.Time    `bson:"last_login_at,omitempty"`
	LastScanAt   *time.Time    `bson:"last_scan_at,omitempty"`
}

func (u *mongoUser) toUser() *User {
	out := &User{
		ID:           u.ID.Hex(),
		Email:        u.Email,
		ScansAllowed: u.ScansAllowed,
		ScansUsed:    u.ScansUsed,
		Status:       u.Status,
		CreatedAt:    u.CreatedAt.UTC().Format(time.RFC3339),
	}
	if u.LastLoginAt != nil && !u.LastLoginAt.IsZero() {
		out.LastLoginAt = u.LastLoginAt.UTC().Format(time.RFC3339)
	}
	if u.LastScanAt != nil && !u.LastScanAt.IsZero() {
		out.LastScanAt = u.LastScanAt.UTC().Format(time.RFC3339)
	}
	return out
}

type mongoLoginCode struct {
	ID        bson.ObjectID `bson:"_id"`
	Email     string        `bson:"email"`
	CodeHash  string        `bson:"code_hash"`
	Attempts  int           `bson:"attempts"`
	ExpiresAt time.Time     `bson:"expires_at"`
}

// NewMongoStore connects to MongoDB, verifies connectivity with Ping, and ensures
// all required collection indexes exist.
func NewMongoStore(ctx context.Context, uri, dbName string) (*MongoStore, error) {
	if uri == "" {
		return nil, fmt.Errorf("mongodb uri is required")
	}
	if dbName == "" {
		dbName = "accessscan"
	}
	clientOpts := options.Client().ApplyURI(uri).SetMaxPoolSize(20)
	client, err := mongo.Connect(clientOpts)
	if err != nil {
		return nil, fmt.Errorf("connect mongodb: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, opTimeout)
	defer cancel()
	if err := client.Ping(pingCtx, readpref.Primary()); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("ping mongodb: %w", err)
	}

	db := client.Database(dbName)
	s := &MongoStore{
		client:     client,
		db:         db,
		users:      db.Collection("users"),
		loginCodes: db.Collection("login_codes"),
		requests:   db.Collection("access_requests"),
		now:        time.Now,
	}
	if err := s.ensureIndexes(pingCtx); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("create mongodb indexes: %w", err)
	}
	return s, nil
}

func (s *MongoStore) ensureIndexes(ctx context.Context) error {
	if _, err := s.users.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys:    bson.D{{Key: "email", Value: 1}},
		Options: options.Index().SetUnique(true),
	}); err != nil {
		return err
	}

	if _, err := s.loginCodes.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "expires_at", Value: 1}},
			Options: options.Index().SetExpireAfterSeconds(0),
		},
		{
			Keys: bson.D{{Key: "email", Value: 1}},
		},
	}); err != nil {
		return err
	}

	if _, err := s.requests.Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{{Key: "status", Value: 1}, {Key: "requested_at", Value: -1}},
		},
		{
			Keys: bson.D{{Key: "email", Value: 1}, {Key: "status", Value: 1}},
		},
	}); err != nil {
		return err
	}

	return nil
}

func (s *MongoStore) opCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), opTimeout)
}

// Ping verifies the MongoDB deployment is reachable.
func (s *MongoStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx, readpref.Primary())
}

// Close disconnects the underlying MongoDB client.
func (s *MongoStore) Close(ctx context.Context) error {
	return s.client.Disconnect(ctx)
}

// Create records a new pending request or returns an existing pending request for email.
func (s *MongoStore) Create(email string) (req *Request, reviewKey string, created bool, err error) {
	ctx, cancel := s.opCtx()
	defer cancel()
	email = normEmail(email)

	var existing Request
	err = s.requests.FindOne(ctx, bson.D{
		{Key: "email", Value: email},
		{Key: "status", Value: StatusPending},
	}).Decode(&existing)
	if err == nil {
		return copyOf(&existing), "", false, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return nil, "", false, err
	}

	reviewKey = randomToken(24)
	r := &Request{
		ID:            randomToken(9),
		Email:         email,
		Status:        StatusPending,
		RequestedAt:   s.now().UTC().Format(time.RFC3339),
		ReviewKeyHash: hash(reviewKey),
	}
	if _, err := s.requests.InsertOne(ctx, r); err != nil {
		return nil, "", false, err
	}
	return copyOf(r), reviewKey, true, nil
}

// CreateTrial issues the one-time free-scan code for a newly registered email.
func (s *MongoStore) CreateTrial(email string, scans int) (code string, created bool, err error) {
	if scans <= 0 {
		return "", false, fmt.Errorf("trial scans must be positive")
	}
	ctx, cancel := s.opCtx()
	defer cancel()
	email = normEmail(email)

	var existing Request
	err = s.requests.FindOne(ctx, bson.D{
		{Key: "email", Value: email},
		{Key: "kind", Value: KindTrial},
	}).Decode(&existing)
	if err == nil {
		return "", false, nil
	}
	if !errors.Is(err, mongo.ErrNoDocuments) {
		return "", false, err
	}

	code = "AS-" + randomToken(18)
	now := s.now().UTC().Format(time.RFC3339)
	r := &Request{
		ID:          randomToken(9),
		Email:       email,
		Kind:        KindTrial,
		Status:      StatusApproved,
		RequestedAt: now,
		DecidedAt:   now,
		CodeHash:    hash(code),
		MaxScans:    scans,
	}
	if _, err := s.requests.InsertOne(ctx, r); err != nil {
		return "", false, err
	}
	return code, true, nil
}

// Get returns a copy of the request with the given ID.
func (s *MongoStore) Get(id string) (*Request, error) {
	ctx, cancel := s.opCtx()
	defer cancel()
	var r Request
	if err := s.requests.FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&r); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return copyOf(&r), nil
}

// CheckReviewKey reports whether key matches the request's review link.
func (s *MongoStore) CheckReviewKey(id, key string) error {
	r, err := s.Get(id)
	if err != nil {
		return err
	}
	if key == "" || subtle.ConstantTimeCompare([]byte(hash(key)), []byte(r.ReviewKeyHash)) != 1 {
		return ErrBadKey
	}
	return nil
}

// Approve approves a pending request and returns it with the new plain access code.
func (s *MongoStore) Approve(id string, maxScans int, ttl time.Duration) (*Request, string, error) {
	if maxScans <= 0 {
		return nil, "", fmt.Errorf("max scans must be positive")
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	code := "AS-" + randomToken(18)
	now := s.now().UTC()
	setFields := bson.D{
		{Key: "status", Value: StatusApproved},
		{Key: "decided_at", Value: now.Format(time.RFC3339)},
		{Key: "code_hash", Value: hash(code)},
		{Key: "max_scans", Value: maxScans},
		{Key: "used_scans", Value: 0},
	}
	if ttl > 0 {
		setFields = append(setFields, bson.E{Key: "expires_at", Value: now.Add(ttl).Format(time.RFC3339)})
	}

	var updated Request
	err := s.requests.FindOneAndUpdate(
		ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "status", Value: StatusPending}},
		bson.D{{Key: "$set", Value: setFields}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updated)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			if _, getErr := s.Get(id); errors.Is(getErr, ErrNotFound) {
				return nil, "", ErrNotFound
			} else if getErr != nil {
				return nil, "", getErr
			}
			return nil, "", ErrNotPending
		}
		return nil, "", err
	}
	return copyOf(&updated), code, nil
}

// Deny rejects a pending request.
func (s *MongoStore) Deny(id string) (*Request, error) {
	return s.setRequestStatus(id, StatusDenied, StatusPending)
}

// Revoke disables an approved code.
func (s *MongoStore) Revoke(id string) (*Request, error) {
	return s.setRequestStatus(id, StatusRevoked, StatusApproved)
}

func (s *MongoStore) setRequestStatus(id, to, from string) (*Request, error) {
	ctx, cancel := s.opCtx()
	defer cancel()

	var updated Request
	err := s.requests.FindOneAndUpdate(
		ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "status", Value: from}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "status", Value: to},
			{Key: "decided_at", Value: s.now().UTC().Format(time.RFC3339)},
		}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updated)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			if _, getErr := s.Get(id); errors.Is(getErr, ErrNotFound) {
				return nil, ErrNotFound
			} else if getErr != nil {
				return nil, getErr
			}
			return nil, ErrNotPending
		}
		return nil, err
	}
	return copyOf(&updated), nil
}

// Validate checks that code is usable without using a scan.
func (s *MongoStore) Validate(code string) (*Request, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ErrInvalidCode
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	var r Request
	err := s.requests.FindOne(ctx, bson.D{{Key: "code_hash", Value: hash(code)}}).Decode(&r)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrInvalidCode
		}
		return nil, err
	}
	if err := r.usable(s.now()); err != nil {
		return copyOf(&r), err
	}
	return copyOf(&r), nil
}

// Status returns the request by ID and whether it can still be used.
func (s *MongoStore) Status(id string) (*Request, error) {
	r, err := s.Get(id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrInvalidCode
		}
		return nil, err
	}
	return r, r.usable(s.now())
}

// Consume atomically reserves one scan on the legacy access request with the given ID.
func (s *MongoStore) Consume(id string) (*Request, error) {
	ctx, cancel := s.opCtx()
	defer cancel()

	now := s.now().UTC()
	nowStr := now.Format(time.RFC3339)

	filter := bson.D{
		{Key: "_id", Value: id},
		{Key: "status", Value: StatusApproved},
		{Key: "$expr", Value: bson.D{{Key: "$lt", Value: bson.A{"$used_scans", "$max_scans"}}}},
		{Key: "$or", Value: bson.A{
			bson.D{{Key: "expires_at", Value: bson.D{{Key: "$exists", Value: false}}}},
			bson.D{{Key: "expires_at", Value: ""}},
			bson.D{{Key: "expires_at", Value: bson.D{{Key: "$gt", Value: nowStr}}}},
		}},
	}
	update := bson.D{
		{Key: "$inc", Value: bson.D{{Key: "used_scans", Value: 1}}},
		{Key: "$set", Value: bson.D{{Key: "last_used", Value: nowStr}}},
	}
	var updated Request
	err := s.requests.FindOneAndUpdate(
		ctx,
		filter,
		update,
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updated)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			r, getErr := s.Get(id)
			if errors.Is(getErr, ErrNotFound) {
				return nil, ErrInvalidCode
			}
			if getErr != nil {
				return nil, getErr
			}
			if uErr := r.usable(now); uErr != nil {
				return r, uErr
			}
			return r, ErrExhausted
		}
		return nil, err
	}
	return copyOf(&updated), nil
}

// Refund returns one scan to the legacy access request with the given ID.
func (s *MongoStore) Refund(id string) error {
	ctx, cancel := s.opCtx()
	defer cancel()
	_, err := s.requests.UpdateOne(
		ctx,
		bson.D{{Key: "_id", Value: id}, {Key: "used_scans", Value: bson.D{{Key: "$gt", Value: 0}}}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "used_scans", Value: -1}}}},
	)
	return err
}

// List returns all requests, newest first.
func (s *MongoStore) List() ([]*Request, error) {
	ctx, cancel := s.opCtx()
	defer cancel()

	cur, err := s.requests.Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "requested_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var out []*Request
	if err := cur.All(ctx, &out); err != nil {
		return nil, err
	}
	if out == nil {
		out = []*Request{}
	}
	return out, nil
}

// CreateLoginCode generates a 6-digit login code, stores its HMAC-SHA256 hash
// in login_codes with a TTL, and returns the plain code.
func (s *MongoStore) CreateLoginCode(email, secret string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = DefaultLoginCodeTTL
	}
	code, err := generateSixDigitCode()
	if err != nil {
		return "", err
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	doc := mongoLoginCode{
		ID:        bson.NewObjectID(),
		Email:     normEmail(email),
		CodeHash:  hmacCode(secret, code),
		Attempts:  0,
		ExpiresAt: s.now().UTC().Add(ttl),
	}
	if _, err := s.loginCodes.InsertOne(ctx, doc); err != nil {
		return "", err
	}
	return code, nil
}

// VerifyLoginCode verifies the newest unexpired login code for email.
func (s *MongoStore) VerifyLoginCode(email, code, secret string, trialScans int) (*User, bool, error) {
	if trialScans <= 0 {
		trialScans = 5
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	email = normEmail(email)
	code = strings.TrimSpace(code)
	now := s.now().UTC()

	var doc mongoLoginCode
	err := s.loginCodes.FindOne(
		ctx,
		bson.D{
			{Key: "email", Value: email},
			{Key: "expires_at", Value: bson.D{{Key: "$gt", Value: now}}},
		},
		options.FindOne().SetSort(bson.D{{Key: "_id", Value: -1}}),
	).Decode(&doc)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, false, ErrInvalidLoginCode
		}
		return nil, false, err
	}

	expected := hmacCode(secret, code)
	if code == "" || subtle.ConstantTimeCompare([]byte(expected), []byte(doc.CodeHash)) != 1 {
		var updated mongoLoginCode
		incErr := s.loginCodes.FindOneAndUpdate(
			ctx,
			bson.D{{Key: "_id", Value: doc.ID}},
			bson.D{{Key: "$inc", Value: bson.D{{Key: "attempts", Value: 1}}}},
			options.FindOneAndUpdate().SetReturnDocument(options.After),
		).Decode(&updated)
		if incErr != nil {
			if errors.Is(incErr, mongo.ErrNoDocuments) {
				return nil, false, ErrInvalidLoginCode
			}
			return nil, false, incErr
		}
		if updated.Attempts >= MaxLoginCodeAttempts {
			_, _ = s.loginCodes.DeleteOne(ctx, bson.D{{Key: "_id", Value: doc.ID}})
			return nil, false, ErrTooManyAttempts
		}
		return nil, false, ErrInvalidLoginCode
	}

	// Single-use: delete the code before creating/updating the user.
	delRes, err := s.loginCodes.DeleteOne(ctx, bson.D{{Key: "_id", Value: doc.ID}})
	if err != nil {
		return nil, false, err
	}
	if delRes.DeletedCount == 0 {
		return nil, false, ErrInvalidLoginCode
	}

	upRes, err := s.users.UpdateOne(
		ctx,
		bson.D{{Key: "email", Value: email}},
		bson.D{
			{Key: "$set", Value: bson.D{{Key: "last_login_at", Value: now}}},
			{Key: "$setOnInsert", Value: bson.D{
				{Key: "_id", Value: bson.NewObjectID()},
				{Key: "email", Value: email},
				{Key: "scans_allowed", Value: trialScans},
				{Key: "scans_used", Value: 0},
				{Key: "status", Value: UserStatusActive},
				{Key: "created_at", Value: now},
			}},
		},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		return nil, false, err
	}

	var u mongoUser
	if err := s.users.FindOne(ctx, bson.D{{Key: "email", Value: email}}).Decode(&u); err != nil {
		return nil, false, err
	}
	return u.toUser(), upRes.UpsertedCount > 0, nil
}

// GetUser returns the user with the given ID.
func (s *MongoStore) GetUser(id string) (*User, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	var u mongoUser
	if err := s.users.FindOne(ctx, bson.D{{Key: "_id", Value: oid}}).Decode(&u); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return u.toUser(), nil
}

// GetUserByEmail returns the user with the given email.
func (s *MongoStore) GetUserByEmail(email string) (*User, error) {
	ctx, cancel := s.opCtx()
	defer cancel()

	var u mongoUser
	if err := s.users.FindOne(ctx, bson.D{{Key: "email", Value: normEmail(email)}}).Decode(&u); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return u.toUser(), nil
}

// ListUsers returns all users, newest first.
func (s *MongoStore) ListUsers() ([]*User, error) {
	ctx, cancel := s.opCtx()
	defer cancel()

	cur, err := s.users.Find(ctx, bson.D{}, options.Find().SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cur.Close(ctx)

	var docs []mongoUser
	if err := cur.All(ctx, &docs); err != nil {
		return nil, err
	}
	out := make([]*User, 0, len(docs))
	for i := range docs {
		out = append(out, docs[i].toUser())
	}
	return out, nil
}

// ReserveUserScan atomically reserves one scan on an active user account.
func (s *MongoStore) ReserveUserScan(id string) (*User, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	now := s.now().UTC()
	var updated mongoUser
	err = s.users.FindOneAndUpdate(
		ctx,
		bson.D{
			{Key: "_id", Value: oid},
			{Key: "status", Value: UserStatusActive},
			{Key: "$expr", Value: bson.D{{Key: "$lt", Value: bson.A{"$scans_used", "$scans_allowed"}}}},
		},
		bson.D{
			{Key: "$inc", Value: bson.D{{Key: "scans_used", Value: 1}}},
			{Key: "$set", Value: bson.D{{Key: "last_scan_at", Value: now}}},
		},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updated)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			var existing mongoUser
			findErr := s.users.FindOne(ctx, bson.D{{Key: "_id", Value: oid}}).Decode(&existing)
			if errors.Is(findErr, mongo.ErrNoDocuments) {
				return nil, ErrNotFound
			}
			if findErr != nil {
				return nil, findErr
			}
			if existing.Status != UserStatusActive {
				return nil, ErrUserBlocked
			}
			return nil, ErrExhausted
		}
		return nil, err
	}
	return updated.toUser(), nil
}

// RefundUserScan returns one reserved scan to the user's account.
func (s *MongoStore) RefundUserScan(id string) error {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return ErrNotFound
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	_, err = s.users.UpdateOne(
		ctx,
		bson.D{{Key: "_id", Value: oid}, {Key: "scans_used", Value: bson.D{{Key: "$gt", Value: 0}}}},
		bson.D{{Key: "$inc", Value: bson.D{{Key: "scans_used", Value: -1}}}},
	)
	return err
}

// ApproveUserScans approves a pending request and adds scans to the user's account.
func (s *MongoStore) ApproveUserScans(requestID string, scans int) (*Request, *User, error) {
	if scans <= 0 {
		return nil, nil, fmt.Errorf("scans must be positive")
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	now := s.now().UTC()
	var updatedReq Request
	err := s.requests.FindOneAndUpdate(
		ctx,
		bson.D{{Key: "_id", Value: requestID}, {Key: "status", Value: StatusPending}},
		bson.D{{Key: "$set", Value: bson.D{
			{Key: "status", Value: StatusApproved},
			{Key: "decided_at", Value: now.Format(time.RFC3339)},
			{Key: "scans_granted", Value: scans},
		}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updatedReq)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			if _, getErr := s.Get(requestID); errors.Is(getErr, ErrNotFound) {
				return nil, nil, ErrNotFound
			} else if getErr != nil {
				return nil, nil, getErr
			}
			return nil, nil, ErrNotPending
		}
		return nil, nil, err
	}

	var updatedUser mongoUser
	err = s.users.FindOneAndUpdate(
		ctx,
		bson.D{{Key: "email", Value: updatedReq.Email}},
		bson.D{
			{Key: "$inc", Value: bson.D{{Key: "scans_allowed", Value: scans}}},
			{Key: "$setOnInsert", Value: bson.D{
				{Key: "_id", Value: bson.NewObjectID()},
				{Key: "email", Value: updatedReq.Email},
				{Key: "scans_used", Value: 0},
				{Key: "status", Value: UserStatusActive},
				{Key: "created_at", Value: now},
			}},
		},
		options.FindOneAndUpdate().SetUpsert(true).SetReturnDocument(options.After),
	).Decode(&updatedUser)
	if err != nil {
		// Put the request back to pending so the owner can approve it again;
		// otherwise it would read "approved" while the user got no scans.
		if _, rbErr := s.requests.UpdateOne(ctx,
			bson.D{{Key: "_id", Value: requestID}, {Key: "status", Value: StatusApproved}},
			bson.D{
				{Key: "$set", Value: bson.D{{Key: "status", Value: StatusPending}}},
				{Key: "$unset", Value: bson.D{{Key: "decided_at", Value: ""}, {Key: "scans_granted", Value: ""}}},
			},
		); rbErr != nil {
			return nil, nil, fmt.Errorf("add scans: %w (and reverting request %s to pending failed: %v)", err, requestID, rbErr)
		}
		return nil, nil, err
	}
	return copyOf(&updatedReq), updatedUser.toUser(), nil
}

// BlockUser sets a user's status to blocked.
func (s *MongoStore) BlockUser(id string) (*User, error) {
	return s.setUserStatus(id, UserStatusBlocked)
}

// UnblockUser sets a user's status to active.
func (s *MongoStore) UnblockUser(id string) (*User, error) {
	return s.setUserStatus(id, UserStatusActive)
}

func (s *MongoStore) setUserStatus(id, status string) (*User, error) {
	oid, err := bson.ObjectIDFromHex(id)
	if err != nil {
		return nil, ErrNotFound
	}
	ctx, cancel := s.opCtx()
	defer cancel()

	var updated mongoUser
	err = s.users.FindOneAndUpdate(
		ctx,
		bson.D{{Key: "_id", Value: oid}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "status", Value: status}}}},
		options.FindOneAndUpdate().SetReturnDocument(options.After),
	).Decode(&updated)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return updated.toUser(), nil
}
