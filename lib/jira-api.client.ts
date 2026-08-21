import { logger } from './logger';

export async function addJiraComment(issueKey: string, text: string): Promise<void> {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_USER_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !apiToken || !email) {
    logger.warn('Jira API credentials not configured, skipping comment');
    return;
  }

  const url = `${baseUrl}/rest/api/3/issue/${issueKey}/comment`;
  const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  const content = buildAdfContent(text);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          version: 1,
          type: 'doc',
          content,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error(`Jira comment failed: ${response.status}`, body);
    } else {
      logger.log(`Commented on ${issueKey}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to comment on ${issueKey}`, msg);
  }
}

function buildAdfContent(text: string): unknown[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  const inlineNodes: unknown[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (urlRegex.test(part)) {
      urlRegex.lastIndex = 0;
      inlineNodes.push({
        type: 'inlineCard',
        attrs: { url: part },
      });
    } else {
      inlineNodes.push({ type: 'text', text: part });
    }
  }

  return [
    {
      type: 'paragraph',
      content: inlineNodes.length > 0 ? inlineNodes : [{ type: 'text', text }],
    },
  ];
}
