# Agent Orchestrator

Receive Jira webhooks on Vercel, run Claude Code on local repos, push branches and create PRs automatically.

## Architecture

```
┌─────────────── Vercel (cloud, 24/7) ───────────────┐
│                                                      │
│   Jira ──POST /api/webhooks/jira──▶ Create job (DB) │
│                                          │           │
│   Cron (daily) ──▶ Cleanup old jobs      │           │
│                                          │           │
│                        Neon PostgreSQL ◀──┘           │
│                              │                       │
└──────────────────────────────┼───────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Local Worker        │
                    │  (polls DB every 5s) │
                    │                      │
                    │  1. git checkout      │
                    │  2. claude --print    │
                    │  3. git push          │
                    │  4. gh pr create      │
                    └──────────────────────┘
```

### Job Lifecycle

```
PENDING → QUEUED → RUNNING → COMPLETED
                           → FAILED
```

### API Endpoints (Vercel)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/webhooks/jira` | Jira webhook (returns `202`) |
| `POST` | `/api/webhooks/github/callback` | GitHub Actions callback |
| `GET` | `/api/jobs` | List jobs (`?status=RUNNING&limit=10`) |
| `GET` | `/api/jobs/[id]` | Get job by ID |
| `GET` | `/api/cron/cleanup` | Daily cron: delete old jobs |

---

## Prerequisites

| Tool | Install | Purpose |
|------|---------|---------|
| Node.js 18+ | `brew install node` | Runtime |
| pnpm | `npm install -g pnpm` | Package manager |
| Vercel CLI | `npm install -g vercel` | Deploy & dev |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` | AI coding agent |
| GitHub CLI | `brew install gh` | Create PRs |

Authenticate:

```bash
claude                # follow login prompt
gh auth login         # GitHub CLI
vercel login          # Vercel CLI
```

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd my-agent-orchestrator
pnpm install
```

### 2. Set Up Vercel + Database

```bash
# Link to Vercel project
vercel link

# Create Neon Postgres via Vercel Dashboard:
# Project → Storage → Create Database → Neon Serverless Postgres
```

Vercel auto-creates `DATABASE_URL` and `DIRECT_URL` env vars.

```bash
# Run migrations
vercel env pull .env.local
dotenv -e .env.local -- npx prisma migrate deploy
```

### 3. Configure Vercel Environment Variables

```bash
vercel env add JIRA_WEBHOOK_SECRET      # random string: openssl rand -hex 32
vercel env add JIRA_AI_USERNAME         # your Jira account ID (see below)
vercel env add JIRA_BASE_URL            # https://your-org.atlassian.net
vercel env add JIRA_API_TOKEN           # from id.atlassian.com
vercel env add JIRA_USER_EMAIL          # email for Jira API auth
vercel env add CALLBACK_SECRET          # random string for GitHub callback
vercel env add REPO_MAPPINGS            # JSON (see below)
```

**REPO_MAPPINGS** format:

```json
{"IVY":{"repoPath":"/Users/you/projects/ivy-2","baseBranch":"dev"}}
```

### 4. Deploy

```bash
vercel --prod
```

Your webhook URL: `https://your-project.vercel.app/api/webhooks/jira`

### 5. Configure Jira Webhook

1. Go to **Jira → Settings → System → WebHooks**
2. Create webhook:
   - **URL**: `https://your-project.vercel.app/api/webhooks/jira`
   - **Header**: `x-webhook-secret` = your `JIRA_WEBHOOK_SECRET`
   - **Events**: Issue → updated
   - **JQL filter** (optional): `project in (IVY, MIABOS)`

### 6. Set Up Local Worker

Create `.env` in project root:

```env
DATABASE_URL=postgresql://user:pass@ep-xxx.region.neon.tech:5432/dbname?sslmode=require
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_API_TOKEN=your-jira-api-token
JIRA_USER_EMAIL=your-email@company.com
GH_TOKEN=ghp_xxxxxxxxxxxx
```

Use the **direct** (non-pooled) Neon connection URL for the worker.

Ensure repos are cloned locally:

```bash
git clone git@github.com:your-org/ivy-2.git /path/to/ivy-2
```

Start the worker:

```bash
pnpm worker
# → Worker started, polling every 5s...
```

---

## Test End-to-End

1. Start worker: `pnpm worker`
2. Assign a Jira ticket to the AI user
3. Watch worker logs — job picked up within 5 seconds
4. PR appears on GitHub, comment posted on Jira ticket

### Simulate with curl

```bash
curl -X POST https://your-project.vercel.app/api/webhooks/jira \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <your-secret>" \
  -d '{
    "timestamp": 1724150400000,
    "webhookEvent": "jira:issue_updated",
    "user": { "accountId": "user-1", "displayName": "Test User" },
    "issue": {
      "id": "10001",
      "key": "IVY-42",
      "fields": {
        "summary": "Add login API endpoint",
        "description": "Create POST /auth/login with JWT token response",
        "project": { "id": "1", "key": "IVY", "name": "Ivy" },
        "assignee": { "accountId": "<JIRA_AI_USERNAME>", "displayName": "AI" },
        "status": { "name": "To Do" },
        "issuetype": { "name": "Story" },
        "priority": { "name": "Medium" }
      }
    },
    "changelog": {
      "id": "12345",
      "items": [{
        "field": "assignee",
        "fieldtype": "jira",
        "from": null,
        "fromString": null,
        "to": "<JIRA_AI_USERNAME>",
        "toString": "AI"
      }]
    }
  }'
```

Expected: `{ "status": "accepted", "jobId": "..." }`

---

## Commands

```bash
pnpm dev                   # Vercel dev server (local)
pnpm worker                # Start local worker
pnpm worker:dev            # Worker with .env loaded
pnpm typecheck             # TypeScript check
pnpm prisma:migrate        # Run migrations (dev)
pnpm prisma:migrate:deploy # Run migrations (prod)
pnpm prisma:studio         # Open Prisma Studio
pnpm deploy                # Deploy to Vercel
```

---

## Project Structure

```
api/                       # Vercel serverless functions
├── webhooks/jira.ts       # Jira webhook handler
├── webhooks/github/
│   └── callback.ts        # GitHub callback handler
├── jobs/
│   ├── index.ts           # GET /api/jobs
│   └── [id].ts            # GET /api/jobs/[id]
├── cron/cleanup.ts        # Daily cleanup cron
└── health.ts              # Health check

lib/                       # Shared code (plain TypeScript)
├── prisma.ts              # Prisma client singleton
├── types.ts               # All interfaces & enums
├── errors.ts              # AppError + ErrorCode
├── logger.ts              # Structured console logger
├── jobs.service.ts        # Job CRUD & state transitions
├── jira.service.ts        # Webhook processing logic
├── jira-api.client.ts     # Post comments on Jira
├── callbacks.service.ts   # GitHub callback handling
├── repository-resolver.ts # Project key → repo mapping
└── claude-code.worker.ts  # Claude Code execution

worker/
└── index.ts               # Polling loop + orchestration

prisma/
└── schema.prisma          # Database schema
```

---

## How to Get `JIRA_AI_USERNAME`

This is your **Jira account ID** (not display name):

```bash
curl -s -u your-email@company.com:<JIRA_API_TOKEN> \
  https://your-org.atlassian.net/rest/api/3/myself | jq .accountId
```

---

## Monitoring

```bash
# List all jobs
curl https://your-project.vercel.app/api/jobs | jq .

# Filter by status
curl "https://your-project.vercel.app/api/jobs?status=FAILED" | jq .

# Specific job
curl https://your-project.vercel.app/api/jobs/<jobId> | jq .
```

Worker logs include job context:

```
[INFO] [jobId=xxx] [jira=IVY-42] [repo=/path/to/repo] Starting agent execution
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Webhook returns 401 | Check `x-webhook-secret` header matches `JIRA_WEBHOOK_SECRET` in Vercel env |
| Webhook returns 202 / "ignored" | Event is not an assignment, or assignee doesn't match `JIRA_AI_USERNAME` |
| Jobs stuck in PENDING | Is the worker running? Is it connected to the correct DB? |
| Job FAILED "Repository not found" | Check `REPO_MAPPINGS` / `repos.json` — repo must be cloned locally |
| Worker can't connect to DB | Use the **direct** (non-pooled) Neon URL with `?sslmode=require` |
| No PR created | Run `gh auth status`, check `GH_TOKEN` has `repo` scope |

---

## Vercel Free Plan Limits

| Resource | Limit | Our Usage |
|----------|-------|-----------|
| Serverless executions | 100GB-hrs/month | Webhook handlers run < 1s |
| Function timeout | 60s | Handlers complete in ~200ms |
| Cron jobs | 2 | 1 used (daily cleanup) |
| Postgres (Neon) | 256MB | Cleaned daily (30-day retention) |

See [docs/architecture.md](docs/architecture.md) and [docs/setup.md](docs/setup.md) for detailed documentation.
