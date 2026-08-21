import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleWebhookEvent } from '../../lib/jira.service';
import { logger } from '../../lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // TODO: Jira Cloud does not support custom headers on webhooks.
  // Consider alternative auth (IP allowlist, signed payloads) in production.

  const event = req.body;
  logger.log(
    `Webhook received: ${event.webhookEvent} issue=${event.issue?.key} assignee=${event.issue?.fields?.assignee?.accountId}`,
  );

  try {
    const usernamesRaw = process.env.JIRA_AI_USERNAMES;
    if (!usernamesRaw) {
      return res.status(500).json({ error: 'JIRA_AI_USERNAMES not configured' });
    }

    const registeredUserIds = usernamesRaw.split(',').map((s) => s.trim()).filter(Boolean);

    const result = await handleWebhookEvent(event, registeredUserIds);

    if (!result) {
      return res.status(202).json({ status: 'ignored' });
    }

    return res.status(202).json({ status: 'accepted', jobId: result.jobId });
  } catch (error) {
    logger.error('Webhook handler error', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
