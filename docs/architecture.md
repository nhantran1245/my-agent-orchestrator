# Architecture

## Overview

Agent Orchestrator is a **multi-user, split architecture** system:
- **Vercel API** (cloud, 24/7): receives Jira webhooks, stores jobs in a shared database
- **Local workers** (per user): each user runs their own worker that polls for their jobs and executes Claude Code

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
│  │  /api/cron/       │───────┤                                       │
│  │  cleanup (7 days) │       │                                       │
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
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────▼───────┐  ┌────▼───────┐  ┌────▼───────┐
   │  Worker User A  │  │  Worker B   │  │  Worker C   │
   │  WORKER_USER_ID │  │             │  │             │
   │  = 712020:aaa   │  │  ...        │  │  ...        │
   │                 │  │             │  │             │
   │  polls WHERE    │  │             │  │             │
   │  assignee = A   │  │             │  │             │
   │  AND PENDING    │  │             │  │             │
   └─────────────────┘  └─────────────┘  └─────────────┘
```

## Multi-User Model

- **Admin** deploys Vercel API and sets `JIRA_AI_USERNAMES` (comma-separated list of Jira account IDs)
- **Vercel API** accepts webhooks for any registered user and stores `assigneeAccountId` on each job
- **Each user** runs their own worker with `WORKER_USER_ID` set to their Jira account ID
- **Workers filter** by `assigneeAccountId` — each worker only processes its own jobs

## Components

### Vercel API (Cloud — always on)

Serverless functions that receive external events and expose job data.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/jira` | POST | Receive Jira webhook, create job for the assigned user |
| `/api/webhooks/github/callback` | POST | Receive GitHub Actions callback, update job |
| `/api/jobs` | GET | List jobs (filter by `?status=X&assignee=Y`) |
| `/api/jobs/[id]` | GET | Get job details |
| `/api/health` | GET | Health check |
| `/api/cron/cleanup` | GET | Daily cron: delete COMPLETED/FAILED jobs older than 7 days |

### Shared Library (`lib/`)

Plain TypeScript modules shared by both API routes and the worker.

| File | Purpose |
|------|---------|
| `prisma.ts` | Prisma client singleton |
| `types.ts` | All interfaces: Jira webhook, job input, agent result, callbacks |
| `errors.ts` | `AppError` class and `ErrorCode` enum |
| `logger.ts` | Structured console logger |
| `jobs.service.ts` | Job CRUD and state transitions, supports filtering by `assigneeAccountId` |
| `jira.service.ts` | Webhook event processing: check assignee against registered users, create job |
| `jira-api.client.ts` | Post comments on Jira tickets (PR links) |
| `callbacks.service.ts` | Handle GitHub callback: update job status |
| `repository-resolver.ts` | Map Jira project key → repo path + base branch (worker-only) |
| `claude-code.worker.ts` | Execute Claude Code CLI, git operations, PR creation (worker-only) |

### Local Worker (`worker/`)

A standalone Node.js process that polls the database every 5 seconds for PENDING jobs **belonging to its user**.

**Execution flow per job:**

```
1. Poll DB: WHERE status = PENDING AND assigneeAccountId = WORKER_USER_ID
2. Resolve project key → local repo path (from repos.json)
3. Transition: PENDING → QUEUED → RUNNING
4. cd to local repo path
5. git checkout baseBranch && git pull
6. git checkout -b agent/{issue-key}
7. Run: claude --print --dangerously-skip-permissions <prompt>
8. git add -A && git commit && git push
9. gh pr create
10. Transition: RUNNING → COMPLETED (store PR URL, diff stats)
11. Post PR link as comment on Jira ticket
```

### Database

Single table `agent_jobs` in PostgreSQL (Vercel Postgres / Neon):

```
agent_jobs
├── id                 UUID (PK)
├── jiraIssueKey       String       "IVY-42"
├── jiraProjectKey     String       "IVY"
├── assigneeAccountId  String       "712020:xxxx" ← which user's worker should process this
├── repoPath           String?      filled by worker after repo resolution
├── baseBranch         String?      filled by worker after repo resolution
├── agentType          String       "claude-code"
├── status             Enum         PENDING | QUEUED | RUNNING | COMPLETED | FAILED
├── idempotencyKey     String       "jira:IVY-42:assign:12345" (unique)
├── createdAt          DateTime
├── updatedAt          DateTime
├── startedAt          DateTime?
├── completedAt        DateTime?
├── error              Text?
└── metadata           JSON?        { summary, description, prUrl, claudeOutput, ... }
```

**Cleanup:** Daily cron deletes COMPLETED/FAILED jobs older than 7 days (Neon free tier = 256MB).

## Data Flow

### Webhook → Job Creation

```
Jira (assign ticket to a registered user)
  │
  ▼
POST /api/webhooks/jira
  │
  ├── Is it an assignee change event?         No → 202 { status: "ignored" }
  ├── Is assignee in JIRA_AI_USERNAMES list?  No → 202 { status: "ignored" }
  ├── Generate idempotency key
  ├── Job already exists?                     Yes → 202 { status: "ignored" }
  │
  ▼
INSERT agent_jobs (status=PENDING, assigneeAccountId=<assignee>)
  │
  ▼
202 { status: "accepted", jobId: "..." }
```

### Job Processing (per user)

```
Worker polls DB every 5s
  WHERE status = PENDING AND assigneeAccountId = WORKER_USER_ID
  │
  ├── No jobs → sleep
  │
  ▼
Pick oldest PENDING job (for this user)
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

## Project Structure

```
my-agent-orchestrator/
├── api/                          # Vercel serverless functions
│   ├── webhooks/
│   │   ├── jira.ts               # Jira webhook handler
│   │   └── github/
│   │       └── callback.ts       # GitHub callback handler
│   ├── jobs/
│   │   ├── index.ts              # List jobs (filter by status, assignee)
│   │   └── [id].ts               # Get job by ID
│   ├── cron/
│   │   └── cleanup.ts            # Daily cleanup cron (7-day retention)
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
├── worker/                       # Local worker (per user)
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
