import { AgentJob } from '@prisma/client';

// Re-export Prisma types
export { AgentJob, JobStatus } from '@prisma/client';

// --- Job types ---

export interface CreateJobInput {
  jiraIssueKey: string;
  jiraProjectKey: string;
  assigneeAccountId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

// --- Agent types ---

export interface AgentResult {
  success: boolean;
  branchName?: string;
  pullRequestUrl?: string;
  claudeOutput?: string;
  diffStats?: string;
  error?: string;
}

export interface AgentWorker {
  execute(job: AgentJob): Promise<AgentResult>;
}

// --- Jira webhook types ---

export interface JiraWebhookEvent {
  timestamp: number;
  webhookEvent: string;
  issue_event_type_name?: string;
  user: JiraUser;
  issue: JiraIssue;
  changelog?: JiraChangelog;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
}

export interface JiraIssueFields {
  summary: string;
  description?: string | null;
  project: {
    id: string;
    key: string;
    name: string;
  };
  assignee?: JiraUser | null;
  status: {
    name: string;
  };
  issuetype: {
    name: string;
  };
  priority?: {
    name: string;
  };
}

export interface JiraChangelog {
  id: string;
  items: JiraChangelogItem[];
}

export interface JiraChangelogItem {
  field: string;
  fieldtype: string;
  from: string | null;
  fromString: string | null;
  to: string | null;
  toString: string | null;
}

// --- GitHub callback types ---

export enum CallbackStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface GitHubCallbackPayload {
  jobId: string;
  status: CallbackStatus;
  branchName?: string;
  pullRequestUrl?: string;
  error?: string;
}

// --- Repository mapping ---

export interface RepositoryMapping {
  repoPath: string;
  baseBranch: string;
}
