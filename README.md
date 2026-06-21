# Web Accessibility API

A Go‑based service that scans webpages for WCAG 2.1 compliance, evaluates scores, and protects the scan endpoints with JWT authentication.

---

## 📦 Project Overview

- **Language**: Go (1.22+ recommended)
- **Core features**:
  - Scan a URL using Axe and return a detailed WCAG report.
  - Compute a compliance score.
  - Secure the `/scan` and `/score` endpoints with JWT (HS256).
  - Public token‑generation endpoint (`POST /api/v1/token`).
- **Design goals**: simplicity, fast startup, clear API, and easy integration with tools such as Postman.

---

## 🛠️ Prerequisites

| Tool | Minimum version |
|------|-----------------|
| **Go** | 1.22 |
| **Node.js** (for Axe runner) | 14 |
| **openssl** (for secret generation) | any |

---

## ⚙️ Setup & Configuration

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd webaccessibility
   ```

2. **Create a JWT secret** – this secret is used to sign and verify tokens. Keep it private and **do not commit** it to source control.
   ```bash
   export JWT_SECRET=$(openssl rand -base64 32)
   ```
   You can also place it in a `.env` file (see *Optional* below).

3. **Optional `.env` file** (useful for local development)
   ```dotenv
   # .env (project root)
   JWT_SECRET=your‑super‑strong‑random‑string
   PORT=8080               # default is 8080
   SCAN_TIMEOUT_SECONDS=30
   WCAG_LEVEL=AA
   MAX_CONCURRENT_SCANS=5
   ```
   Load it in the same shell before starting the server:
   ```bash
   export $(grep -v '^#' .env | xargs)
   ```

---

## ▶️ Running the Server

```bash
# Run directly (uses environment variables from the current shell)
go run ./cmd/server/main.go
```

The server will start on `:8080` (or the value of `PORT`). You’ll see logs like:
```
{"level":"info","msg":"server starting","addr":":8080"}
```

---

## 🔐 Authentication – JWT

- **Algorithm**: HS256 (symmetric). 
- **Token lifetime**: 30 minutes (hard‑coded in `internal/api/jwt_middleware.go`).
- **How to obtain a token**: Call the public endpoint **POST `/api/v1/token`** with the secret you set in `JWT_SECRET`.

### Request payload
```json
{ "client_secret": "<your‑JWT‑secret>" }
```

### Successful response
```json
{ "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

All other protected routes require the header:
```
Authorization: Bearer <token>
```

---

## 📡 API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| **GET** | `/api/v1/` | Service information (lists available endpoints) | ❌ |
| **GET** | `/api/v1/health` | Health check (`status: ok`) | ❌ |
| **POST** | `/api/v1/token` | Generate a JWT (public) | ❌ |
| **POST** | `/api/v1/scan` | Run a full WCAG scan and return the report | ✅ |
| **POST** | `/api/v1/score` | Run a scan and return only the scoring summary | ✅ |

### Example `curl` commands

```bash
# 1️⃣ Service info
curl -X GET http://localhost:8080/api/v1/

# 2️⃣ Health check
curl -X GET http://localhost:8080/api/v1/health

# 3️⃣ Generate a token (replace <YOUR_SECRET>)
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/token \
       -H "Content-Type: application/json" \
       -d '{"client_secret":"<YOUR_SECRET>"}' | jq -r .token)

# 4️⃣ Scan a page (protected)
curl -X POST http://localhost:8080/api/v1/scan \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"url":"https://www.wikipedia.org","wcag_level":"AA","depth":0}'

# 5️⃣ Score only (protected)
curl -X POST http://localhost:8080/api/v1/score \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"url":"https://www.wikipedia.org","wcag_level":"AA","depth":0}'
```

---

## 🧪 Running Tests

There are currently no unit tests, but you can verify the build:
```bash
go test ./...
```
If you add tests later, they will be discovered automatically.

---

## 📂 Project Structure (high‑level)
```
webaccessibility/
├─ cmd/server/main.go          # Server bootstrap
├─ internal/
│  ├─ api/
│  │   ├─ handler.go          # HTTP handlers (scan, score, token)
│  │   ├─ router.go           # Route definitions & middleware wiring
│  │   ├─ jwt_middleware.go   # JWT validation
│  │   └─ middleware.go       # Logging, request‑id, etc.
│  ├─ config/
│  │   └─ config.go           # Loads env vars (including JWT_SECRET)
│  ├─ scanner/
│  │   └─ axe_runner.go       # Executes Axe via Node.js
│  ├─ scoring/
│  │   └─ score.go            # Score calculations
│  └─ models/
│      └─ wcag_mapping.go      # WCAG rule → category map
└─ go.mod                      # Dependencies (incl. golang‑jwt/v4)
```

---

## 📘 Postman Collection (quick start)
1. **Import** the following JSON into Postman (File → Import → Raw Text):
```json
{
  "info": {"name": "Web Accessibility API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
  "item": [
    {"name": "Generate Token", "request": {"method": "POST","header": [{"key":"Content-Type","value":"application/json"}],"url": {"raw":"http://localhost:8080/api/v1/token","protocol":"http","host":["localhost"],"port":"8080","path":["api","v1","token"]},"body": {"mode":"raw","raw":"{\"client_secret\": \"{{JWT_SECRET}}\"}"}}},
    {"name": "Scan Page", "request": {"method": "POST","header": [{"key":"Content-Type","value":"application/json"},{"key":"Authorization","value":"Bearer {{TOKEN}}"}],"url": {"raw":"http://localhost:8080/api/v1/scan","protocol":"http","host":["localhost"],"port":"8080","path":["api","v1","scan"]},"body": {"mode":"raw","raw":"{\"url\": \"https://www.wikipedia.org\", \"wcag_level\": \"AA\", \"depth\": 0 }"}}},
    {"name": "Score Only", "request": {"method": "POST","header": [{"key":"Content-Type","value":"application/json"},{"key":"Authorization","value":"Bearer {{TOKEN}}"}],"url": {"raw":"http://localhost:8080/api/v1/score","protocol":"http","host":["localhost"],"port":"8080","path":["api","v1","score"]},"body": {"mode":"raw","raw":"{\"url\": \"https://www.wikipedia.org\", \"wcag_level\": \"AA\", \"depth\": 0 }"}}}
  ]
}
```
2. **Set environment variables** in Postman:
   - `JWT_SECRET` → the same secret you exported.
   - `TOKEN` → (leave blank; you’ll populate it after the *Generate Token* request). Add a **Test** script to the *Generate Token* request to automatically store the token:
```javascript
pm.environment.set("TOKEN", pm.response.json().token);
```
3. Run the collection – the first request creates a JWT and the following requests use it automatically.

---

## 🚀 Next Steps / Extensibility
- Add rate‑limiting or IP‑based restrictions.
- Extend the API with a `GET /api/v1/report/{id}` to retrieve stored scan results.
- Write unit tests for the handler logic and JWT middleware.

---

*Happy scanning!*
