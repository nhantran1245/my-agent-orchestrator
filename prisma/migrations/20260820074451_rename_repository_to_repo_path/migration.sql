/*
  Warnings:

  - You are about to drop the column `repository` on the `agent_jobs` table. All the data in the column will be lost.
  - Added the required column `repoPath` to the `agent_jobs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "agent_jobs" DROP COLUMN "repository",
ADD COLUMN     "repoPath" TEXT NOT NULL;
