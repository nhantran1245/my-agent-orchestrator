import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getJob } from '../../lib/jobs.service';
import { AppError, ErrorCode } from '../../lib/errors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid job ID' });
  }

  try {
    const job = await getJob(id);
    return res.json(job);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.JOB_NOT_FOUND) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
