# Agent Orchestrator

Multi-user Jira → Claude Code → GitHub PR automation. Vercel receives webhooks 24/7, each user runs their own local worker.

## How It Works

```
┌─────────────── Vercel (cloud, 24/7) ───────────────┐
│                                                      │
│   Jira ──POST /api/webhooks/jira──▶ Create job (DB) │
│   (assign ticket to a registered user)               │
│                                                      │
│   Cron (daily) ──▶ Cleanup jobs > 7 days             │
│                                                      │
│                        Neon PostgreSQL ◀─────────    │
└────────────────────────────┼─────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───────┐  ┌──▼───────┐  ┌──▼───────┐
     │ Worker (User A) │  │ Worker B │  │ Worker C │
     │ polls own jobs  │  │          │  │          │
     │                 │  │          │  │          │
     │ claude --print  │  │  ...     │  │  ...     │
     │ git push        │  │          │  │          │
     │ gh pr create    │  │          │  │          │
     └─────────────────┘  └──────────┘  └──────────┘
```

Each worker only picks up jobs assigned to its `WORKER_USER_ID`.

### Job Lifecycle

```
PENDING → QUEUED → RUNNING → COMPLETED
                           → FAILED
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhooks/jira` | Jira webhook (returns `202`) |
| `POST` | `/api/webhooks/github/callback` | GitHub Actions callback |
| `GET` | `/api/jobs` | List jobs (`?status=RUNNING&assignee=<id>&limit=10`) |
| `GET` | `/api/jobs/[id]` | Get job by ID |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/cron/cleanup` | Daily cron: delete jobs older than 7 days |

---

## Admin Setup (one-time)

The admin deploys the Vercel API and manages the list of registered users.

### Prerequisites

| Tool | Install | Purpose |
|------|---------|---------|
| Node.js 18+ | `brew install node` | Runtime |
| pnpm | `npm install -g pnpm` | Package manager |
| Vercel CLI | `npm install -g vercel` | Pull env vars |

### 1. Clone & Install

```bash
git clone <repo-url>
cd my-agent-orchestrator
pnpm install
```

### 2. Deploy to Vercel

1. Push repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** your repository → **Deploy**

### 3. Create Database

1. Vercel project → **Storage** tab → **Create Database** → **Neon Serverless Postgres**
2. Run migrations:

```bash
vercel env pull .env.local
npx prisma migrate deploy
```

### 4. Set Environment Variables

Vercel project → **Settings** → **Environment Variables**:

| Name | Value | Notes |
|------|-------|-------|
| `JIRA_WEBHOOK_SECRET` | `openssl rand -hex 32` | Random string |
| `JIRA_AI_USERNAMES` | `712020:aaa,712020:bbb` | Comma-separated Jira account IDs of all registered users |
| `JIRA_BASE_URL` | `https://your-org.atlassian.net` | |
| `JIRA_API_TOKEN` | *(from id.atlassian.com)* | [Create API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_USER_EMAIL` | `admin@company.com` | Email for Jira API basic auth |
| `CALLBACK_SECRET` | `openssl rand -hex 32` | For GitHub callback auth |

After saving, **Redeploy** from the Deployments tab.

### 5. Configure Jira Webhook

1. **Jira → Settings → System → WebHooks**
2. Create webhook:
   - **URL**: `https://your-project.vercel.app/api/webhooks/jira`
   - **Header**: `x-webhook-secret` = your `JIRA_WEBHOOK_SECRET`
   - **Events**: Issue → updated

### 6. Add a New User

1. Get the user's **Jira account ID** (see [How to find account ID](#how-to-find-jira-account-id))
2. Add their ID to `JIRA_AI_USERNAMES` in Vercel env vars (comma-separated)
3. Redeploy
4. Share with the user: **database URL** and their **Jira account ID**

---

## Worker Setup (each user)

Each user runs their own worker on their local machine.

### Prerequisites

| Tool | Install | Purpose |
|------|---------|---------|
| Node.js 18+ | `brew install node` | Runtime |
| pnpm | `npm install -g pnpm` | Package manager |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` | AI coding agent |
| GitHub CLI | `brew install gh` | Create PRs |

```bash
claude                # follow login prompt
gh auth login         # GitHub CLI
```

### 1. Clone & Install

```bash
git clone <repo-url>
cd my-agent-orchestrator
pnpm install
```

### 2. Create `.env`

```env
# Your Jira account ID — worker only picks up YOUR jobs
WORKER_USER_ID=712020:your-account-id

# Database — use the DIRECT (non-pooled) Neon URL (get from admin)
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech:5432/neondb?sslmode=require
DIRECT_URL=postgresql://user:pass@ep-xxx.neon.tech:5432/neondb?sslmode=require

# Jira API (for posting PR links as comments)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_API_TOKEN=your-jira-api-token
JIRA_USER_EMAIL=your-email@company.com

# GitHub CLI
GH_TOKEN=ghp_xxxxxxxxxxxx
```

### 3. Configure `repos.json`

Map Jira project keys to your local repo paths:

```json
{
  "IVY": {
    "repoPath": "/Users/you/projects/ivy-2",
    "baseBranch": "dev"
  }
}
```

Ensure repos are cloned:

```bash
git clone git@github.com:your-org/ivy-2.git /Users/you/projects/ivy-2
```

### 4. Start Worker

```bash
pnpm worker
# → Worker started for user 712020:your-account-id, polling every 5s...
```

The worker only picks up jobs where `assigneeAccountId` matches your `WORKER_USER_ID`.

---

## Test End-to-End

1. Start your worker: `pnpm worker`
2. In Jira, assign a ticket to yourself (your account must be in `JIRA_AI_USERNAMES`)
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
        "assignee": { "accountId": "<YOUR_JIRA_ACCOUNT_ID>", "displayName": "You" },
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
        "to": "<YOUR_JIRA_ACCOUNT_ID>",
        "toString": "You"
      }]
    }
  }'
```

---

## How to Find Jira Account ID

```bash
curl -s -u your-email@company.com:<JIRA_API_TOKEN> \
  https://your-org.atlassian.net/rest/api/3/myself | jq .accountId
```

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
```

---

## Project Structure

```
api/                       # Vercel serverless functions
├── webhooks/jira.ts       # Jira webhook → create job
├── webhooks/github/
│   └── callback.ts        # GitHub callback → update job
├── jobs/
│   ├── index.ts           # GET /api/jobs
│   └── [id].ts            # GET /api/jobs/[id]
├── cron/cleanup.ts        # Weekly cleanup cron
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
├── repository-resolver.ts # Project key → repo mapping (worker-only)
└── claude-code.worker.ts  # Claude Code execution (worker-only)

worker/
└── index.ts               # Polling loop (filters by WORKER_USER_ID)

prisma/
└── schema.prisma          # Database schema
```

---

## Monitoring

```bash
# All jobs
curl https://your-project.vercel.app/api/jobs | jq .

# Jobs for a specific user
curl "https://your-project.vercel.app/api/jobs?assignee=712020:xxx" | jq .

# Filter by status
curl "https://your-project.vercel.app/api/jobs?status=FAILED" | jq .
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Webhook returns 401 | Check `x-webhook-secret` matches `JIRA_WEBHOOK_SECRET` |
| Webhook returns 202 / "ignored" | Assignee not in `JIRA_AI_USERNAMES` list |
| Jobs stuck in PENDING | Worker not running, or `WORKER_USER_ID` doesn't match the job's assignee |
| Job FAILED "No repository mapping" | Check `repos.json` — project key must match |
| Job FAILED "Repository not found" | Clone the repo locally first |
| Worker can't connect to DB | Use **direct** (non-pooled) Neon URL with `?sslmode=require` |
| No PR created | Run `gh auth status`, check `GH_TOKEN` has `repo` scope |

---

## Vercel Free Plan Limits

| Resource | Limit | Our Usage |
|----------|-------|-----------|
| Serverless executions | 100GB-hrs/month | Webhook handlers < 1s |
| Function timeout | 60s | Handlers ~200ms |
| Cron jobs | 2 | 1 used (daily cleanup) |
| Postgres (Neon) | 256MB | Cleaned weekly (7-day retention) |

See [docs/architecture.md](docs/architecture.md) and [docs/setup.md](docs/setup.md) for detailed documentation.
