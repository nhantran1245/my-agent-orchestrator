# Agent Orchestrator

Multi-user split architecture: Vercel serverless API + local workers per user.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Run Vercel dev server locally
pnpm worker               # Start local worker (polls DB for YOUR jobs)
pnpm worker:dev           # Start worker with .env loaded
pnpm typecheck            # TypeScript check
pnpm prisma:migrate       # Run DB migrations (dev)
pnpm prisma:migrate:deploy # Run DB migrations (production)
```

## Architecture

```
Vercel (cloud, 24/7):  api/webhooks/jira.ts → check JIRA_AI_USERNAMES → create job with assigneeAccountId
Worker (per user):     worker/index.ts → polls WHERE assignee = WORKER_USER_ID → runs Claude Code → creates PR
Shared code:           lib/ (prisma, services, types)
```

## Config

- `.env` — local worker: WORKER_USER_ID, DB, Jira, GitHub
- Vercel env vars — JIRA_AI_USERNAMES (comma-sep), webhook secret, DB
- `repos.json` — Jira project key → local repo path + branch (per user)

## Flow

```
Jira webhook → POST /api/webhooks/jira → check assignee ∈ JIRA_AI_USERNAMES → create job → return 202
Worker poll  → WHERE assignee = WORKER_USER_ID → resolve repo → claude --print → commit → push → gh pr create
Cron cleanup → daily delete COMPLETED/FAILED jobs > 7 days
```

## Key conventions

- Plain TypeScript functions in lib/ (no framework)
- Vercel API routes in api/ (serverless functions)
- Worker filters jobs by WORKER_USER_ID
- Each user has own repos.json, own .env, own worker process
- Idempotency via `idempotencyKey` on `AgentJob`
- Structured logging: jobId, jiraIssueKey, repository, status
- Never log secrets
