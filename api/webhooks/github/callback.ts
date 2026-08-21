import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCallback } from '../../../lib/callbacks.service';
import { AppError, ErrorCode } from '../../../lib/errors';
import { logger } from '../../../lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate callback secret
  const secret = process.env.CALLBACK_SECRET;
  if (secret) {
    const provided =
      req.headers['x-callback-secret'] ||
      (req.headers['authorization']
        ? (req.headers['authorization'] as string).replace('Bearer ', '')
        : null);

    if (!provided || provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const job = await handleCallback(req.body);
    return res.json({ status: 'ok', jobId: job.id, jobStatus: job.status });
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.JOB_NOT_FOUND) {
      return res.status(404).json({ error: error.message });
    }
    logger.error('Callback handler error', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: 'Internal server error' });
  }
}
