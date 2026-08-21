import { AgentJob } from '@prisma/client';
import { getJob, transitionToCompleted, transitionToFailed } from './jobs.service';
import { logger } from './logger';
import { CallbackStatus, GitHubCallbackPayload } from './types';

export async function handleCallback(payload: GitHubCallbackPayload): Promise<AgentJob> {
  const job = await getJob(payload.jobId);

  const logCtx = {
    jobId: job.id,
    jiraIssueKey: job.jiraIssueKey,
    repository: job.repoPath,
  };

  if (payload.status === CallbackStatus.COMPLETED) {
    logger.log('GitHub Actions workflow completed', {
      ...logCtx,
      status: 'COMPLETED',
    });

    return transitionToCompleted(job.id, {
      branchName: payload.branchName,
      pullRequestUrl: payload.pullRequestUrl,
    });
  }

  const errorMsg = payload.error || 'GitHub Actions workflow failed';
  logger.error('GitHub Actions workflow failed', errorMsg, logCtx);
  return transitionToFailed(job.id, errorMsg);
}
