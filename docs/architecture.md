# Architecture

## Overview

Agent Orchestrator uses a **split architecture**: a Vercel serverless API receives webhooks 24/7, while a local worker processes jobs on the developer's machine.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLOUD (Vercel)                             │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  POST             │  │  POST             │  │  GET             │  │
│  │  /api/webhooks/   │  │  /api/webhooks/   │  │  /api/jobs       │  │
│  │  jira             │  │  github/callback  │  │  /api/jobs/[id]  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │
│           │                     │                      │            │
│           ▼                     ▼                      ▼            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Shared Library (lib/)                      │   │
│  │  prisma.ts · jobs.service.ts · jira.service.ts · types.ts    │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │                                       │
│  ┌──────────────────┐       │                                       │
│  │  Cron (daily)     │       │                                       │
│  │  /api/cron/       │       │                                       │
│  │  cleanup          │───────┤                                       │
│  └──────────────────┘       │                                       │
│                             ▼                                       │
│                   ┌──────────────────┐                               │
│                   │  Vercel Postgres  │                               │
│                   │  (Neon)           │                               │
│                   └────────┬─────────┘                               │
└────────────────────────────┼────────────────────────────────────────┘
                             │
                    ╔════════╧════════╗
                    ║  PostgreSQL DB   ║
                    ║  (shared)        ║
                    ╚════════╤════════╝
                             │
┌────────────────────────────┼────────────────────────────────────────┐
│                LOCAL MACHINE                                        │
│                             │                                       │
│                   ┌─────────▼────────┐                              │
│                   │  worker/index.ts  │                              │
│                   │  (polling 5s)     │                              │
│                   └─────────┬────────┘                              │
│                             │                                       │
│              ┌──────────────┼──────────────┐                        │
│              ▼              ▼              ▼                        │
│     ┌──────────────┐ ┌───────────┐ ┌────────────┐                  │
│     │ Claude Code   │ │ git ops   │ │ gh pr      │                  │
│     │ CLI           │ │ (local)   │ │ create     │                  │
│     └──────────────┘ └───────────┘ └────────────┘                  │
│                                                                     │
│     Local repos: /path/to/ivy-2, /path/to/mia-chatbot, ...        │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### Vercel API (Cloud — always on)

Serverless functions that receive external events and expose job data. Stateless, no long-running processes.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/jira` | POST | Receive Jira webhook, create job in DB |
| `/api/webhooks/github/callback` | POST | Receive GitHub Actions callback, update job |
| `/api/jobs` | GET | List jobs (filterable by status) |
| `/api/jobs/[id]` | GET | Get job details |
| `/api/health` | GET | Health check |
| `/api/cron/cleanup` | GET | Daily cron: delete jobs older than 30 days |

### Shared Library (`lib/`)

Plain TypeScript modules shared by both API routes and the worker. Zero framework dependencies.

| File | Purpose |
|------|---------|
| `prisma.ts` | Prisma client singleton (works in both serverless & long-running) |
| `types.ts` | All interfaces: Jira webhook, job input, agent result, callbacks |
| `errors.ts` | `AppError` class and `ErrorCode` enum |
| `logger.ts` | Structured console logger |
| `jobs.service.ts` | Job CRUD and state transitions (PENDING → QUEUED → RUNNING → COMPLETED/FAILED) |
| `jira.service.ts` | Webhook event processing: filter assignment events, resolve repo, create job |
| `jira-api.client.ts` | Post comments on Jira tickets (PR links) |
| `callbacks.service.ts` | Handle GitHub callback: update job status |
| `repository-resolver.ts` | Map Jira project key → repo path + base branch (from `repos.json` or `REPO_MAPPINGS` env var, worker-only) |
| `claude-code.worker.ts` | Execute Claude Code CLI, git operations, PR creation (worker-only) |

### Local Worker (`worker/`)

A standalone Node.js process that polls the database every 5 seconds for PENDING jobs.

**Execution flow per job:**

```
1. Poll DB for PENDING jobs (limit 1)
2. Transition: PENDING → QUEUED → RUNNING
3. cd to local repo path
4. git checkout baseBranch && git pull
5. git checkout -b agent/{issue-key}
6. Run: claude --print --dangerously-skip-permissions <prompt>
7. git add -A && git commit && git push
8. gh pr create (with decisions/review sections from Claude output)
9. Transition: RUNNING → COMPLETED (store PR URL, diff stats)
10. Post PR link as comment on Jira ticket
```

If any step fails → transition to FAILED with error message.

### Database

Single table `agent_jobs` in PostgreSQL (Vercel Postgres / Neon):

```
agent_jobs
├── id              UUID (PK)
├── jiraIssueKey    String       "IVY-42"
├── jiraProjectKey  String       "IVY"
├── repoPath        String?      filled by worker after repo resolution
├── baseBranch      String?      filled by worker after repo resolution
├── agentType       String       "claude-code"
├── status          Enum         PENDING | QUEUED | RUNNING | COMPLETED | FAILED
├── idempotencyKey  String       "jira:IVY-42:assign:12345" (unique)
├── createdAt       DateTime
├── updatedAt       DateTime
├── startedAt       DateTime?
├── completedAt     DateTime?
├── error           Text?
└── metadata        JSON?        { summary, description, prUrl, claudeOutput, ... }
```

**Cleanup:** A Vercel cron job runs daily to delete COMPLETED/FAILED jobs older than 30 days, keeping the free-tier 256MB storage under control.

## Data Flow

### Webhook → Job Creation

```
Jira (assign ticket to AI user)
  │
  ▼
POST /api/webhooks/jira
  │
  ├── Is it an assignee change event? No → 202 { status: "ignored" }
  ├── Is assignee the AI user?        No → 202 { status: "ignored" }
  ├── Generate idempotency key: jira:{issueKey}:assign:{changelogId}
  ├── Check if job already exists     Yes → 202 { status: "ignored" }
  │
  ▼
INSERT agent_jobs (status=PENDING, raw Jira data only)
  │
  ▼
202 { status: "accepted", jobId: "..." }
```

### Job Processing

```
Worker polls DB every 5s
  │
  ├── No PENDING jobs → sleep
  │
  ▼
Pick oldest PENDING job
  │
  ├── Resolve project key → repo path (from local repos.json)
  ├── PENDING → QUEUED → RUNNING
  │
  ▼
Execute Claude Code on local repo
  │
  ├── Success → COMPLETED + comment PR link on Jira
  └── Failure → FAILED + store error
```

### Cleanup

```
Vercel Cron (daily at 02:00 UTC)
  │
  ▼
DELETE FROM agent_jobs
WHERE status IN ('COMPLETED', 'FAILED')
AND completedAt < now() - 30 days
```

## Project Structure

```
my-agent-orchestrator/
├── api/                          # Vercel serverless functions
│   ├── webhooks/
│   │   ├── jira.ts               # Jira webhook handler
│   │   └── github/
│   │       └── callback.ts       # GitHub callback handler
│   ├── jobs/
│   │   ├── index.ts              # List jobs
│   │   └── [id].ts               # Get job by ID
│   ├── cron/
│   │   └── cleanup.ts            # Daily cleanup cron
│   └── health.ts                 # Health check
├── lib/                          # Shared code (no framework deps)
│   ├── prisma.ts
│   ├── types.ts
│   ├── errors.ts
│   ├── logger.ts
│   ├── jobs.service.ts
│   ├── jira.service.ts
│   ├── jira-api.client.ts
│   ├── callbacks.service.ts
│   ├── repository-resolver.ts
│   └── claude-code.worker.ts
├── worker/                       # Local worker
│   └── index.ts
├── prisma/
│   └── schema.prisma
├── vercel.json
├── package.json
├── tsconfig.json
└── docs/
    ├── architecture.md           # This file
    └── setup.md                  # Setup guide
```
