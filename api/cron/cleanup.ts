import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteOldJobs } from '../../lib/jobs.service';
import { logger } from '../../lib/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron sends GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const deletedCount = await deleteOldJobs(7);
    logger.log(`Cleanup completed: deleted ${deletedCount} old jobs`);
    return res.json({ status: 'ok', deletedCount });
  } catch (error) {
    logger.error('Cleanup failed', error instanceof Error ? error.message : String(error));
    return res.status(500).json({ error: 'Cleanup failed' });
  }
}
