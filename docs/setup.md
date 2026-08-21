# Setup Guide

## Prerequisites

- Node.js 18+
- pnpm
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- [GitHub CLI](https://cli.github.com/): `gh` (for PR creation)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code): `claude`
- A Jira Cloud account with webhook access

---

## 1. Vercel Project Setup

### 1.1 Create Vercel Project

```bash
# Login to Vercel
vercel login

# Link this directory to a Vercel project
vercel link
```

### 1.2 Create Vercel Postgres (Neon) Database

1. Go to [Vercel Dashboard](https://vercel.com/dashboard) → your project → **Storage** tab
2. Click **Create Database** → select **Neon Serverless Postgres**
3. Choose a region close to you (e.g., `sin1` for Singapore)
4. Vercel auto-creates these env vars:
   - `POSTGRES_URL` (pooled — use for `DATABASE_URL`)
   - `POSTGRES_URL_NON_POOLED` (direct — use for `DIRECT_URL`)
   - `POSTGRES_PRISMA_URL` (pooled with `?pgbouncer=true` — **use this as `DATABASE_URL`**)

### 1.3 Run Database Migrations

```bash
# Pull Vercel env vars locally
vercel env pull .env.local

# Run Prisma migrations against Neon
dotenv -e .env.local -- npx prisma migrate deploy
```

### 1.4 Set Vercel Environment Variables

Via CLI:

```bash
# Jira config
vercel env add JIRA_WEBHOOK_SECRET         # shared secret for webhook auth
vercel env add JIRA_AI_USERNAME             # your Jira account ID (the "AI user")
vercel env add JIRA_BASE_URL               # https://your-org.atlassian.net
vercel env add JIRA_API_TOKEN              # Jira API token
vercel env add JIRA_USER_EMAIL             # email for Jira API basic auth

# GitHub callback
vercel env add CALLBACK_SECRET             # shared secret for GitHub callback auth

# Repository mappings (JSON string)
vercel env add REPO_MAPPINGS               # e.g. {"IVY":{"repoPath":"/path/to/repo","baseBranch":"dev"}}
```

Or via [Vercel Dashboard](https://vercel.com/dashboard) → project → **Settings** → **Environment Variables**.

### 1.5 Deploy

```bash
# Preview deploy
vercel

# Production deploy
vercel --prod
```

Your webhook URL will be: `https://your-project.vercel.app/api/webhooks/jira`

---

## 2. Jira Webhook Setup

1. Go to Jira → **Settings** → **System** → **WebHooks**
2. Click **Create a WebHook**
3. Configure:
   - **Name**: Agent Orchestrator
   - **URL**: `https://your-project.vercel.app/api/webhooks/jira`
   - **Secret**: same value as `JIRA_WEBHOOK_SECRET`
   - **Events**: Issue → updated
   - **JQL Filter** (optional): `project = IVY` to limit to specific projects
4. Save

### Finding Your Jira AI Username (Account ID)

The `JIRA_AI_USERNAME` is a Jira **account ID**, not a display name. To find it:

```bash
curl -s -u your-email@company.com:YOUR_API_TOKEN \
  https://your-org.atlassian.net/rest/api/3/myself \
  | jq '.accountId'
```

Or assign a ticket to the AI user and check the webhook payload's `changelog.items[].to` value.

---

## 3. Local Worker Setup

### 3.1 Install Dependencies

```bash
pnpm install
```

### 3.2 Configure Environment

Create a `.env` file in the project root:

```bash
# Database — use the DIRECT (non-pooled) Neon URL for long-running worker
DATABASE_URL=postgresql://user:pass@ep-xxx.region.neon.tech:5432/dbname?sslmode=require

# Jira API (for posting PR links as comments)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_API_TOKEN=your-jira-api-token
JIRA_USER_EMAIL=your-email@company.com

# GitHub CLI (for creating PRs)
GH_TOKEN=ghp_xxxxxxxxxxxx
```

**Important**: The worker connects to the **same Neon database** as Vercel. Use the **direct** (non-pooled) connection URL since the worker is a single long-running process.

### 3.3 Repository Setup

Ensure all repositories referenced in `REPO_MAPPINGS` (or `repos.json`) are cloned locally:

```bash
# Example
git clone git@github.com:your-org/ivy-2.git /path/to/ivy-2
git clone git@github.com:your-org/mia-chatbot.git /path/to/mia-chatbot
```

The worker needs read/write access to these directories.

### 3.4 Configure Repository Mappings

For the local worker, you can either:

**Option A**: Use `repos.json` (default, file in project root):

```json
{
  "IVY": {
    "repoPath": "/Users/you/projects/ivy-2",
    "baseBranch": "dev"
  },
  "MIABOS": {
    "repoPath": "/Users/you/projects/mia-chatbot",
    "baseBranch": "develop"
  }
}
```

**Option B**: Set `REPO_MAPPINGS` env var (same JSON, as a string).

If both exist, the env var takes precedence.

### 3.5 Start the Worker

```bash
# Development mode
pnpm worker

# Or with explicit env file
pnpm worker:dev
```

The worker will:
- Connect to the Neon database
- Poll for PENDING jobs every 5 seconds
- Execute Claude Code CLI on local repos
- Create PRs via `gh` CLI
- Post PR links on Jira tickets

### 3.6 Verify Setup

```bash
# Check worker can connect to DB
pnpm worker  # Should print "Worker started, polling every 5s..."

# Check API is live
curl https://your-project.vercel.app/api/health
# → {"status":"ok"}

# Manually test webhook (dry run)
curl -X POST https://your-project.vercel.app/api/webhooks/jira \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret" \
  -d '{"webhookEvent":"jira:issue_updated","issue":{"key":"TEST-1","fields":{"summary":"Test","project":{"key":"IVY"},"assignee":{"accountId":"your-ai-username"},"status":{"name":"Open"},"issuetype":{"name":"Task"}}},"changelog":{"id":"1","items":[{"field":"assignee","to":"your-ai-username","fieldtype":"jira","from":null,"fromString":null,"toString":"AI"}]},"user":{"accountId":"x","displayName":"x"},"timestamp":0}'
```

---

## 4. GitHub CLI Authentication

The worker uses `gh` CLI to create pull requests. Authenticate once:

```bash
gh auth login
# Or set GH_TOKEN in .env
```

---

## 5. End-to-End Test

1. Start the worker: `pnpm worker`
2. In Jira, assign a ticket to the AI user
3. Watch the worker logs — it should pick up the job within 5 seconds
4. A PR should appear in the target repo
5. A comment with the PR link should appear on the Jira ticket

---

## 6. Vercel Free Plan Limits

| Resource | Free Limit | Our Usage |
|----------|-----------|-----------|
| Serverless function executions | 100GB-hours/month | Minimal (webhook handlers run < 1s) |
| Function timeout | 60 seconds | Webhook handlers complete in ~200ms |
| Bandwidth | 100GB/month | Small JSON payloads |
| Cron jobs | 2 allowed | 1 used (daily cleanup) |
| Postgres storage (Neon) | 256MB | Cleaned up daily (30-day retention) |
| Deployments | 100/day | Well within limit |

---

## 7. Environment Variables Reference

### Vercel (Cloud)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon pooled connection string (auto-set by Vercel Postgres) |
| `DIRECT_URL` | Yes | Neon direct connection string (for migrations) |
| `JIRA_WEBHOOK_SECRET` | Yes | Shared secret to validate incoming Jira webhooks |
| `JIRA_AI_USERNAME` | Yes | Jira account ID that triggers job creation |
| `JIRA_BASE_URL` | Yes | Jira instance URL (e.g., `https://org.atlassian.net`) |
| `JIRA_API_TOKEN` | Yes | Jira API token for posting comments |
| `JIRA_USER_EMAIL` | Yes | Email for Jira API basic auth |
| `CALLBACK_SECRET` | Yes | Shared secret for GitHub callback webhook |
| `REPO_MAPPINGS` | Yes | JSON string mapping project keys to repo paths |

### Local Worker (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon **direct** (non-pooled) connection string |
| `JIRA_BASE_URL` | Yes | Same as Vercel |
| `JIRA_API_TOKEN` | Yes | Same as Vercel |
| `JIRA_USER_EMAIL` | Yes | Same as Vercel |
| `GH_TOKEN` | Yes | GitHub personal access token for `gh` CLI |

---

## Troubleshooting

### Worker can't connect to database
- Ensure `DATABASE_URL` uses the **direct** Neon URL (not pooled)
- Check that `?sslmode=require` is in the connection string
- Verify the Neon project is active (free tier pauses after inactivity)

### Webhook returns 401
- Check `JIRA_WEBHOOK_SECRET` matches between Jira config and Vercel env vars
- Ensure the `x-webhook-secret` header is being sent

### No PR created
- Ensure `gh auth status` shows authenticated
- Check `GH_TOKEN` is set and has `repo` scope
- Verify the repo has push access for the authenticated user

### Jobs stuck in PENDING
- Is the worker running? Check `pnpm worker`
- Is the worker connected to the correct database?
- Check worker logs for errors

### Neon database paused
- Neon free tier pauses after 5 minutes of inactivity
- First connection after pause takes ~1-2s to wake up
- The worker's polling keeps the connection alive
