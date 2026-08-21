import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleWebhookEvent } from '../../lib/jira.service';
import { AppError, ErrorCode } from '../../lib/errors';
import { logger } from '../../lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate webhook secret
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      req.headers['x-webhook-secret'] ||
      (req.headers['authorization']
        ? (req.headers['authorization'] as string).replace('Bearer ', '')
        : null);

    if (!provided || provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const event = req.body;
  logger.log(
    `Webhook received: ${event.webhookEvent} issue=${event.issue?.key} assignee=${event.issue?.fields?.assignee?.accountId}`,
  );

  try {
    const aiUsername = process.env.JIRA_AI_USERNAME;
    if (!aiUsername) {
      return res.status(500).json({ error: 'JIRA_AI_USERNAME not configured' });
    }

    const result = await handleWebhookEvent(event, aiUsername);

    if (!result) {
      return res.status(202).json({ status: 'ignored' });
    }

    return res.status(202).json({ status: 'accepted', jobId: result.jobId });
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === ErrorCode.UNKNOWN_JIRA_PROJECT) {
        return res.status(404).json({ error: error.message });
      }
      return res.status(400).json({ error: error.message });
    }
    logger.error('Webhook handler error', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
