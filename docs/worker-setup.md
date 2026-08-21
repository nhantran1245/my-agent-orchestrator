# Worker Setup — Local Machine

This guide is for **each user** who runs a local worker to process their Jira tasks with Claude Code.

---

## Prerequisites

| Tool | Install | Purpose |
|------|---------|---------|
| Node.js 18+ | `brew install node` | Runtime |
| pnpm | `npm install -g pnpm` | Package manager |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` | AI coding agent |
| GitHub CLI | `brew install gh` | Create PRs |

---

## What You Need from the Admin

Before starting, ask the admin for:

1. **Neon database URL** (direct, non-pooled connection string)
2. **Your Jira account ID** (e.g. `712020:xxxx-xxxx-xxxx`)
3. Confirmation that your account ID is added to the registered users list

---

## 1. Clone & Install

```bash
git clone <repo-url>
cd my-agent-orchestrator
pnpm install
```

---

## 2. Create `.env`

Create a `.env` file in the project root:

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

# GitHub personal access token (for creating PRs)
GH_TOKEN=ghp_xxxxxxxxxxxx
```

### How to get each value

| Variable | How to get it |
|----------|---------------|
| `WORKER_USER_ID` | From admin, or run the command below |
| `DATABASE_URL` / `DIRECT_URL` | From admin (Neon direct URL) |
| `JIRA_API_TOKEN` | [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_USER_EMAIL` | Your Atlassian account email |
| `GH_TOKEN` | [github.com → Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) (needs `repo` scope) |

**Find your Jira account ID:**

```bash
curl -s -u your-email@company.com:YOUR_JIRA_API_TOKEN \
  https://your-org.atlassian.net/rest/api/3/myself \
  | jq .accountId
```

---

## 3. Configure `repos.json`

Create `repos.json` in the project root. This maps Jira project keys to your local repo paths:

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

| Field | Description |
|-------|-------------|
| Key (e.g. `IVY`) | Jira project key — visible in ticket IDs like `IVY-42` |
| `repoPath` | Absolute path to a **pre-cloned** git repo on your machine |
| `baseBranch` | Branch to create feature branches from |

Ensure all repos are cloned:

```bash
git clone git@github.com:your-org/ivy-2.git /Users/you/projects/ivy-2
git clone git@github.com:your-org/mia-chatbot.git /Users/you/projects/mia-chatbot
```

---

## 4. Start the Worker

```bash
pnpm worker
```

You should see:

```
Dashboard running at http://localhost:3099/dashboard
Worker started for user 712020:your-account-id, polling every 5s...
```

The worker will:
- Poll the database every 5 seconds for **your** pending jobs
- Run Claude Code CLI on your local repos
- Commit, push, and create a PR on GitHub
- Post the PR link as a comment on the Jira ticket

---

## 5. Dashboard

Open **http://localhost:3099/dashboard** in your browser to see your jobs.

- Auto-refreshes every 10 seconds
- Shows only your jobs (filtered by `WORKER_USER_ID`)
- Click a row to see full details: Claude output, diff stats, errors

Change the dashboard port with `DASHBOARD_PORT` in `.env` (default: `3099`).

---

## 6. Test It

1. Make sure your worker is running
2. In Jira, assign a ticket (from a configured project) to yourself
3. Watch the worker logs — it should pick up the job within 5 seconds
4. A PR will appear on GitHub
5. A comment with the PR link will appear on the Jira ticket
6. Check the dashboard at http://localhost:3099/dashboard

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKER_USER_ID` | Yes | Your Jira account ID — worker only processes your jobs |
| `DATABASE_URL` | Yes | Neon **direct** (non-pooled) connection string |
| `DIRECT_URL` | Yes | Same as DATABASE_URL (needed for Prisma) |
| `JIRA_BASE_URL` | Yes | Jira instance URL (e.g. `https://your-org.atlassian.net`) |
| `JIRA_API_TOKEN` | Yes | Your personal Jira API token |
| `JIRA_USER_EMAIL` | Yes | Your Atlassian email |
| `GH_TOKEN` | Yes | GitHub personal access token (`repo` scope) |
| `DASHBOARD_PORT` | No | Dashboard port (default: `3099`) |

---

## Troubleshooting

### Worker exits with "WORKER_USER_ID is required"
- Add `WORKER_USER_ID=your-jira-account-id` to `.env`

### Worker can't connect to database
- Ensure `DATABASE_URL` uses the **direct** Neon URL (not the pooled one)
- The direct URL does NOT have `-pooler` in the hostname
- Check `?sslmode=require` is in the connection string
- Neon free tier pauses after inactivity — first reconnect takes ~1-2s

### Jobs stuck in PENDING
- Is your worker running?
- Does `WORKER_USER_ID` match the `assigneeAccountId` on the job?
- Is your account ID in the admin's `JIRA_AI_USERNAMES` list?

### No PR created
- Run `gh auth status` to verify GitHub CLI is authenticated
- Check `GH_TOKEN` is set in `.env` and has `repo` scope
- Check worker logs for `Failed to create PR` with stderr details

### Job FAILED "No repository mapping"
- Check `repos.json` — the Jira project key (e.g. `IVY`) must match
- Ensure the key matches exactly (case-sensitive)

### Job FAILED "Repository not found"
- Clone the repo first: `git clone ... /path/to/repo`
- Check the `repoPath` in `repos.json` is correct

### Dashboard shows weird characters
- Make sure you're using the latest version of `worker/dashboard.ts`
