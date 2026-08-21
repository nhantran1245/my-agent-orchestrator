# Agent Orchestrator

Split architecture: Vercel serverless API + local worker.

## Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Run Vercel dev server locally
pnpm worker               # Start local worker (polls DB for jobs)
pnpm worker:dev           # Start worker with .env loaded
pnpm typecheck            # TypeScript check
pnpm prisma:migrate       # Run DB migrations (dev)
pnpm prisma:migrate:deploy # Run DB migrations (production)
pnpm deploy               # Deploy to Vercel
```

## Architecture

```
Vercel (cloud, 24/7):  api/webhooks/jira.ts → creates job in Neon DB
Local worker:          worker/index.ts → polls DB → runs Claude Code → creates PR
Shared code:           lib/ (prisma, services, types)
```

## Config

- `.env` — local worker secrets (DB, Jira, GitHub)
- Vercel env vars — cloud config (DB, Jira webhook secret, repo mappings)
- `repos.json` — Jira project key → local repo path + branch (local fallback)

## Flow

```
Jira webhook → POST /api/webhooks/jira → create job → return 202
Worker poll  → cd repoPath → git pull → branch → claude --print → commit → push → gh pr create
Cron cleanup → daily delete COMPLETED/FAILED jobs > 30 days
```

## Key conventions

- Plain TypeScript functions in lib/ (no framework)
- Vercel API routes in api/ (serverless functions)
- Worker is standalone polling script
- Idempotency via `idempotencyKey` on `AgentJob`
- Structured logging: jobId, jiraIssueKey, repository, status
- Never log secrets
