import type { VercelRequest, VercelResponse } from '@vercel/node';
import { JobStatus } from '@prisma/client';
import { listJobs } from '../../lib/jobs.service';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { status, limit, offset } = req.query;

  const statusStr = typeof status === 'string' ? status : undefined;
  const validStatus =
    statusStr && statusStr in JobStatus ? (statusStr as JobStatus) : undefined;

  const result = await listJobs({
    status: validStatus,
    limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
    offset: typeof offset === 'string' ? parseInt(offset, 10) : undefined,
  });

  return res.json(result);
}
