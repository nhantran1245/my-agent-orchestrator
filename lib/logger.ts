export interface JobLogContext {
  jobId?: string;
  jiraIssueKey?: string;
  repository?: string;
  status?: string;
}

function formatContext(context?: JobLogContext): string {
  if (!context) return '';
  const parts: string[] = [];
  if (context.jobId) parts.push(`jobId=${context.jobId}`);
  if (context.jiraIssueKey) parts.push(`jira=${context.jiraIssueKey}`);
  if (context.repository) parts.push(`repo=${context.repository}`);
  if (context.status) parts.push(`status=${context.status}`);
  return parts.length > 0 ? ` [${parts.join('] [')}]` : '';
}

function formatMessage(level: string, message: string, context?: JobLogContext): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}]${formatContext(context)} ${message}`;
}

export const logger = {
  log(message: string, context?: JobLogContext): void {
    console.log(formatMessage('INFO', message, context));
  },

  error(message: string, trace?: string, context?: JobLogContext): void {
    console.error(formatMessage('ERROR', message, context), trace || '');
  },

  warn(message: string, context?: JobLogContext): void {
    console.warn(formatMessage('WARN', message, context));
  },

  debug(message: string, context?: JobLogContext): void {
    console.debug(formatMessage('DEBUG', message, context));
  },
};
