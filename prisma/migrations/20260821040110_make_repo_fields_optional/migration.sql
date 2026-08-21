-- AlterTable
ALTER TABLE "agent_jobs" ALTER COLUMN "baseBranch" DROP NOT NULL,
ALTER COLUMN "repoPath" DROP NOT NULL;
