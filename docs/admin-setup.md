# Admin Setup — Vercel Hosting

This guide is for the **admin** who deploys and manages the Vercel API, database, and registered users.

---

## 1. Deploy to Vercel

1. Push the repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** the repository → **Deploy**
3. Note the project URL: `https://your-project.vercel.app`

---

## 2. Create Database (Neon Postgres)

1. Vercel project → **Storage** tab → **Create Database** → **Neon Serverless Postgres**
2. Choose a region close to your users (e.g. Singapore)
3. Vercel auto-creates `DATABASE_URL` and `DIRECT_URL` env vars

Run migrations:

```bash
vercel login
vercel link
vercel env pull .env.local
npx prisma migrate deploy
```

---

## 3. Set Environment Variables

Vercel project → **Settings** → **Environment Variables**:

| Name | Value | Description |
|------|-------|-------------|
| `JIRA_AI_USERNAMES` | `712020:aaa,712020:bbb` | Comma-separated Jira account IDs of **all registered users** |
| `JIRA_BASE_URL` | `https://your-org.atlassian.net` | Jira instance URL |
| `JIRA_API_TOKEN` | *(from id.atlassian.com)* | [Create API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_USER_EMAIL` | `admin@company.com` | Email for Jira API basic auth |
| `CALLBACK_SECRET` | `openssl rand -hex 32` | For GitHub callback auth |

After saving, go to **Deployments** → **Redeploy**.

---

## 4. Configure Jira Webhook

1. Go to **Jira → Settings → System → WebHooks**
2. Click **Create a WebHook**:
   - **Name**: Agent Orchestrator
   - **URL**: `https://your-project.vercel.app/api/webhooks/jira`
   - **Events**: Issue → updated
   - **JQL Filter** (optional): `project in (IVY, MIABOS)`

---

## 5. Register a New User

1. Get their Jira account ID:

```bash
curl -s -u your-email:YOUR_API_TOKEN \
  https://your-org.atlassian.net/rest/api/3/user/search?query=their-email \
  | jq '.[0].accountId'
```

Or ask the user to run:

```bash
curl -s -u their-email:THEIR_API_TOKEN \
  https://your-org.atlassian.net/rest/api/3/myself \
  | jq .accountId
```

2. Add their account ID to `JIRA_AI_USERNAMES` in Vercel env vars (comma-separated)
3. **Redeploy** from the Deployments tab
4. Share with the user:
   - The **Neon direct database URL** (non-pooled connection string)
   - Their **Jira account ID**
   - The link to [Worker Setup Guide](worker-setup.md)

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhooks/jira` | Jira webhook (returns `202`) |
| `POST` | `/api/webhooks/github/callback` | GitHub Actions callback |
| `GET` | `/api/jobs` | List jobs (`?status=X&assignee=Y&limit=N`) |
| `GET` | `/api/jobs/[id]` | Get job by ID |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/cron/cleanup` | Daily cron: delete jobs older than 7 days |

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon pooled connection string (auto-set by Vercel Postgres) |
| `DIRECT_URL` | Yes | Neon direct connection string (auto-set by Vercel Postgres) |
| `JIRA_AI_USERNAMES` | Yes | Comma-separated Jira account IDs of all registered users |
| `JIRA_BASE_URL` | Yes | Jira instance URL |
| `JIRA_API_TOKEN` | Yes | Jira API token for posting comments |
| `JIRA_USER_EMAIL` | Yes | Email for Jira API basic auth |
| `CALLBACK_SECRET` | Yes | Shared secret for GitHub callback |

---

## Vercel Free Plan Limits

| Resource | Limit | Our Usage |
|----------|-------|-----------|
| Serverless executions | 100GB-hrs/month | Webhook handlers < 1s |
| Function timeout | 60s | Handlers ~200ms |
| Cron jobs | 2 | 1 used (daily cleanup) |
| Postgres (Neon) | 256MB | Cleaned daily (7-day retention) |
| Deployments | 100/day | Well within limit |

---

## Troubleshooting

### Webhook returns 500 "JIRA_AI_USERNAMES not configured"
- Set `JIRA_AI_USERNAMES` in Vercel env vars and redeploy

### Webhook returns 500 "DATABASE_URL resolved to empty"
- Vercel Postgres may use `POSTGRES_PRISMA_URL` instead of `DATABASE_URL`
- Add `DATABASE_URL` manually, copy the value from `POSTGRES_PRISMA_URL`
- Same for `DIRECT_URL` from `POSTGRES_URL_NON_POOLED`

### Webhook returns 202 but status is "ignored"
- The assignee is not in `JIRA_AI_USERNAMES`
- Or the event is not an assignee change

### Database migrations fail
- Ensure `DIRECT_URL` (non-pooled) is set — migrations can't run through a connection pooler
