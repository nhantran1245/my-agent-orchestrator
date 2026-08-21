import 'dotenv/config';
import {
  findPendingJobs,
  transitionToQueued,
  transitionToRunning,
  transitionToCompleted,
  transitionToFailed,
} from '../lib/jobs.service';
import { execute } from '../lib/claude-code.worker';
import { addJiraComment } from '../lib/jira-api.client';
import { resolveRepository } from '../lib/repository-resolver';
import { logger } from '../lib/logger';

const POLL_INTERVAL = 5000;
let processing = false;

const WORKER_USER_ID = process.env.WORKER_USER_ID;
if (!WORKER_USER_ID) {
  logger.error('WORKER_USER_ID is required. Set it in .env to your Jira account ID.');
  process.exit(1);
}

async function poll(): Promise<void> {
  if (processing) return;

  processing = true;
  try {
    const pendingJobs = await findPendingJobs(1, WORKER_USER_ID);
    if (pendingJobs.length === 0) return;

    const job = pendingJobs[0];

    // Resolve repo mapping locally
    const mapping = resolveRepository(job.jiraProjectKey);
    if (!mapping) {
      logger.error(
        `No repository mapping for project: ${job.jiraProjectKey}`,
        undefined,
        { jobId: job.id, jiraIssueKey: job.jiraIssueKey },
      );
      await transitionToFailed(
        job.id,
        `No repository mapping found for project: ${job.jiraProjectKey}. Check repos.json or REPO_MAPPINGS env var.`,
      );
      return;
    }

    // Enrich job with repo info for the worker
    const enrichedJob = { ...job, repoPath: mapping.repoPath, baseBranch: mapping.baseBranch };

    const logCtx = {
      jobId: job.id,
      jiraIssueKey: job.jiraIssueKey,
      repository: mapping.repoPath,
    };

    logger.log('Processing job', { ...logCtx, status: 'QUEUED' });
    await transitionToQueued(job.id);

    logger.log('Starting agent execution', { ...logCtx, status: 'RUNNING' });
    await transitionToRunning(job.id);

    try {
      const result = await execute(enrichedJob);

      if (result.success) {
        logger.log('Agent execution completed', { ...logCtx, status: 'COMPLETED' });
        await transitionToCompleted(job.id, {
          repoPath: mapping.repoPath,
          baseBranch: mapping.baseBranch,
          branchName: result.branchName,
          pullRequestUrl: result.pullRequestUrl,
          claudeOutput: result.claudeOutput,
          diffStats: result.diffStats,
        });

        if (result.pullRequestUrl) {
          await addJiraComment(job.jiraIssueKey, result.pullRequestUrl);
        }
      } else {
        const errorMsg = result.error || 'Agent execution returned unsuccessful result';
        logger.error('Agent execution failed', errorMsg, logCtx);
        await transitionToFailed(job.id, errorMsg, {
          claudeOutput: result.claudeOutput,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Agent execution error', errorMsg, logCtx);
      await transitionToFailed(job.id, errorMsg);
    }
  } catch (error) {
    logger.error('Job polling error', error instanceof Error ? error.message : String(error));
  } finally {
    processing = false;
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.log('Shutting down worker...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.log('Shutting down worker...');
  process.exit(0);
});

// Start polling
logger.log(`Worker started for user ${WORKER_USER_ID}, polling every 5s...`);
setInterval(poll, POLL_INTERVAL);
