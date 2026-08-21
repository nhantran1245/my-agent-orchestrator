import { JiraWebhookEvent } from './types';
import { logger } from './logger';
import { createJob } from './jobs.service';

export async function handleWebhookEvent(
  event: JiraWebhookEvent,
  aiUsername: string,
): Promise<{ jobId: string } | null> {
  if (!isAssignmentEvent(event)) {
    logger.log('Ignoring non-assignment event', {
      jiraIssueKey: event.issue?.key,
    });
    return null;
  }

  const assignee = getAssignee(event);
  if (!assignee || assignee !== aiUsername) {
    logger.log('Ignoring assignment to non-AI user', {
      jiraIssueKey: event.issue?.key,
    });
    return null;
  }

  const projectKey = event.issue.fields.project.key;
  const issueKey = event.issue.key;
  const idempotencyKey = generateIdempotencyKey(event);

  logger.log('Processing AI assignment', { jiraIssueKey: issueKey });

  const job = await createJob({
    jiraIssueKey: issueKey,
    jiraProjectKey: projectKey,
    idempotencyKey,
    metadata: {
      summary: event.issue.fields.summary,
      description: event.issue.fields.description,
      issueType: event.issue.fields.issuetype.name,
      priority: event.issue.fields.priority?.name,
      assigneeAccountId: assignee,
    },
  });

  if (!job) {
    logger.log('Duplicate webhook event, job already exists', {
      jiraIssueKey: issueKey,
    });
    return null;
  }

  return { jobId: job.id };
}

function isAssignmentEvent(event: JiraWebhookEvent): boolean {
  if (event.webhookEvent !== 'jira:issue_updated') return false;
  if (!event.changelog?.items) return false;
  return event.changelog.items.some((item) => item.field === 'assignee');
}

function getAssignee(event: JiraWebhookEvent): string | null {
  const assigneeChange = event.changelog?.items?.find((item) => item.field === 'assignee');
  if (assigneeChange?.to) return assigneeChange.to;
  return event.issue.fields.assignee?.accountId || null;
}

function generateIdempotencyKey(event: JiraWebhookEvent): string {
  const changelogId = event.changelog?.id || 'no-changelog';
  return `jira:${event.issue.key}:assign:${changelogId}`;
}
