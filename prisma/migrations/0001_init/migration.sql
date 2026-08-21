-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" UUID NOT NULL,
    "jiraIssueKey" TEXT NOT NULL,
    "jiraProjectKey" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "agentType" TEXT NOT NULL DEFAULT 'claude-code',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_jobs_idempotencyKey_key" ON "agent_jobs"("idempotencyKey");

