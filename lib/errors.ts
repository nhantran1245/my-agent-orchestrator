export enum ErrorCode {
  INVALID_WEBHOOK = 'INVALID_WEBHOOK',
  UNAUTHORIZED_WEBHOOK = 'UNAUTHORIZED_WEBHOOK',
  UNKNOWN_JIRA_PROJECT = 'UNKNOWN_JIRA_PROJECT',
  REPOSITORY_NOT_FOUND = 'REPOSITORY_NOT_FOUND',
  AGENT_EXECUTION_FAILED = 'AGENT_EXECUTION_FAILED',
  GITHUB_ERROR = 'GITHUB_ERROR',
  JIRA_ERROR = 'JIRA_ERROR',
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  DUPLICATE_JOB = 'DUPLICATE_JOB',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
