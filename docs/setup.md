# Setup Guide

This system has two roles:
- **Admin**: deploys the Vercel API, manages the database, registers users
- **User**: runs a local worker that processes their own jobs

---

## Part 1: Admin Setup

### Prerequisites

- Node.js 18+, pnpm
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- A Jira Cloud account with admin access to webhooks

### 1.1 Deploy to Vercel

1. Push the repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) → Import the repository → Deploy
3. After deploy, note the project URL: `https://your-project.vercel.app`

### 1.2 Create Database (Neon Postgres)

1. Vercel project → **Storage** tab → **Create Database** → **Neon Serverless Postgres**
2. Choose a region close to your users
3. Vercel auto-creates `DATABASE_URL` and `DIRECT_URL` env vars

Run migrations:

```bash
vercel login
vercel link
vercel env pull .env.local
npx prisma migrate deploy
```

### 1.3 Set Environment Variables

Vercel project → **Settings** → **Environment Variables**:

| Name | Value | Description |
|------|-------|-------------|
| `JIRA_WEBHOOK_SECRET` | Random string | `openssl rand -hex 32` |
| `JIRA_AI_USERNAMES` | `712020:aaa,712020:bbb` | Comma-separated Jira account IDs of **all registered users** |
| `JIRA_BASE_URL` | `https://your-org.atlassian.net` | Jira instance URL |
| `JIRA_API_TOKEN` | *(from id.atlassian.com)* | [Create API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_USER_EMAIL` | `admin@company.com` | Email for Jira API basic auth |
| `CALLBACK_SECRET` | Random string | For GitHub callback auth |

After saving, go to **Deployments** → **Redeploy**.

### 1.4 Configure Jira Webhook

1. Go to **Jira → Settings → System → WebHooks**
2. Click **Create a WebHook**:
   - **Name**: Agent Orchestrator
   - **URL**: `https://your-project.vercel.app/api/webhooks/jira`
   - **Headers**: `x-webhook-secret` = your `JIRA_WEBHOOK_SECRET`
   - **Events**: Issue → updated
   - **JQL Filter** (optional): `project in (IVY, MIABOS)`

### 1.5 Registering a New User

1. Get their Jira account ID:

```bash
curl -s -u email:API_TOKEN \
  https://your-org.atlassian.net/rest/api/3/user/search?query=their-email \
  | jq '.[0].accountId'
```

2. Add their account ID to `JIRA_AI_USERNAMES` (comma-separated) in Vercel env vars
3. Redeploy
4. Share with the user:
   - The **Neon direct database URL** (non-pooled, for their worker)
   - Their **Jira account ID**

---

## Part 2: User (Worker) Setup

### Prerequisites

- Node.js 18+, pnpm
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code): `npm i -g @anthropic-ai/claude-code`
- [GitHub CLI](https://cli.github.com/): `brew install gh`

Authenticate:

```bash
claude         # follow login prompt
gh auth login  # GitHub CLI
```

### 2.1 Clone & Install

```bash
git clone <repo-url>
cd my-agent-orchestrator
pnpm install
```

### 2.2 Create `.env`

```env
# Your Jira account ID — worker only picks up YOUR jobs
WORKER_USER_ID=712020:your-account-id

# Database (get from admin) — use DIRECT (non-pooled) Neon URL
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech:5432/neondb?sslmode=require
DIRECT_URL=postgresql://user:pass@ep-xxx.neon.tech:5432/neondb?sslmode=require

# Jira API (for posting PR links as comments on tickets)
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_API_TOKEN=your-personal-jira-api-token
JIRA_USER_EMAIL=your-email@company.com

# GitHub CLI (for creating PRs)
GH_TOKEN=ghp_xxxxxxxxxxxx
```

### 2.3 Configure `repos.json`

Create `repos.json` in the project root. Map Jira project keys to your local repo paths:

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

Each user has their own `repos.json` with their own local paths.

Ensure repos are cloned:

```bash
git clone git@github.com:your-org/ivy-2.git /Users/you/projects/ivy-2
```

### 2.4 Start the Worker

```bash
pnpm worker
# → Worker started for user 712020:your-account-id, polling every 5s...
```

The worker:
- Connects to the shared Neon database
- Polls for PENDING jobs where `assigneeAccountId` matches your `WORKER_USER_ID`
- Runs Claude Code CLI on your local repos
- Creates PRs via `gh` CLI
- Posts PR links on Jira tickets

### 2.5 Verify

```bash
# Check worker connects to DB
pnpm worker  # Should print startup message without errors

# Check API is live
curl https://your-project.vercel.app/api/health
# → {"status":"ok"}

# Check your jobs
curl "https://your-project.vercel.app/api/jobs?assignee=712020:your-account-id" | jq .
```

---

## Environment Variables Reference

### Vercel (Cloud) — managed by admin

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon pooled connection string (auto-set by Vercel Postgres) |
| `DIRECT_URL` | Yes | Neon direct connection string (auto-set by Vercel Postgres) |
| `JIRA_WEBHOOK_SECRET` | Yes | Shared secret to validate Jira webhooks |
| `JIRA_AI_USERNAMES` | Yes | Comma-separated Jira account IDs of all registered users |
| `JIRA_BASE_URL` | Yes | Jira instance URL |
| `JIRA_API_TOKEN` | Yes | Jira API token for posting comments |
| `JIRA_USER_EMAIL` | Yes | Email for Jira API basic auth |
| `CALLBACK_SECRET` | Yes | Shared secret for GitHub callback |

### Local Worker (.env) — each user

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKER_USER_ID` | Yes | Your Jira account ID (worker only processes your jobs) |
| `DATABASE_URL` | Yes | Neon **direct** (non-pooled) connection string |
| `DIRECT_URL` | Yes | Same as DATABASE_URL (needed for Prisma) |
| `JIRA_BASE_URL` | Yes | Jira instance URL |
| `JIRA_API_TOKEN` | Yes | Your personal Jira API token |
| `JIRA_USER_EMAIL` | Yes | Your email for Jira API auth |
| `GH_TOKEN` | Yes | GitHub personal access token for `gh` CLI |

---

## Troubleshooting

### Worker can't connect to database
- Ensure `DATABASE_URL` uses the **direct** Neon URL (not pooled)
- Check that `?sslmode=require` is in the connection string
- Verify the Neon project is active (free tier pauses after inactivity)

### Webhook returns 401
- Check `JIRA_WEBHOOK_SECRET` matches between Jira and Vercel env vars

### Webhook returns 202 but status is "ignored"
- The assignee is not in `JIRA_AI_USERNAMES`
- Or the event is not an assignee change

### Jobs stuck in PENDING
- Is the worker running?
- Does `WORKER_USER_ID` match the job's `assigneeAccountId`?

### No PR created
- Run `gh auth status`
- Check `GH_TOKEN` is set and has `repo` scope

### Neon database paused
- Neon free tier pauses after 5 minutes of inactivity
- The worker's polling keeps it alive
- First reconnect takes ~1-2s

---

## Vercel Free Plan Limits

| Resource | Free Limit | Our Usage |
|----------|-----------|-----------|
| Serverless function executions | 100GB-hours/month | Minimal (handlers < 1s) |
| Function timeout | 60 seconds | Handlers ~200ms |
| Bandwidth | 100GB/month | Small JSON payloads |
| Cron jobs | 2 allowed | 1 used (daily cleanup) |
| Postgres storage (Neon) | 256MB | Cleaned daily (7-day retention) |
| Deployments | 100/day | Well within limit |
