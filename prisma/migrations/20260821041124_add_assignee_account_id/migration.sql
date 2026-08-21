/*
  Warnings:

  - Added the required column `assigneeAccountId` to the `agent_jobs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "agent_jobs" ADD COLUMN     "assigneeAccountId" TEXT NOT NULL;
