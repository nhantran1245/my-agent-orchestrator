import { AgentJob, JobStatus } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { AppError, ErrorCode } from './errors';
import { CreateJobInput } from './types';

export async function createJob(input: CreateJobInput): Promise<AgentJob | null> {
  const existing = await prisma.agentJob.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    logger.log('Job already exists for idempotency key', {
      jobId: existing.id,
      jiraIssueKey: input.jiraIssueKey,
      status: existing.status,
    });
    return null;
  }

  const job = await prisma.agentJob.create({
    data: {
      jiraIssueKey: input.jiraIssueKey,
      jiraProjectKey: input.jiraProjectKey,
      assigneeAccountId: input.assigneeAccountId,
      idempotencyKey: input.idempotencyKey,
      status: JobStatus.PENDING,
      metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
    },
  });

  logger.log('Agent job created', {
    jobId: job.id,
    jiraIssueKey: job.jiraIssueKey,
    status: job.status,
  });

  return job;
}

export async function getJob(id: string): Promise<AgentJob> {
  const job = await prisma.agentJob.findUnique({ where: { id } });
  if (!job) {
    throw new AppError(ErrorCode.JOB_NOT_FOUND, `Job not found: ${id}`);
  }
  return job;
}

export async function findPendingJobs(
  limit = 10,
  assigneeAccountId?: string,
): Promise<AgentJob[]> {
  return prisma.agentJob.findMany({
    where: {
      status: JobStatus.PENDING,
      ...(assigneeAccountId ? { assigneeAccountId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

export async function transitionToQueued(jobId: string): Promise<AgentJob> {
  return prisma.agentJob.update({
    where: { id: jobId },
    data: { status: JobStatus.QUEUED },
  });
}

export async function transitionToRunning(jobId: string): Promise<AgentJob> {
  return prisma.agentJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.RUNNING,
      startedAt: new Date(),
    },
  });
}

export async function transitionToCompleted(
  jobId: string,
  result?: Record<string, unknown>,
): Promise<AgentJob> {
  const job = await prisma.agentJob.findUnique({ where: { id: jobId } });
  const existingMeta = (job?.metadata as Record<string, unknown>) || {};

  return prisma.agentJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      completedAt: new Date(),
      metadata: result
        ? JSON.parse(JSON.stringify({ ...existingMeta, ...result }))
        : undefined,
    },
  });
}

export async function transitionToFailed(
  jobId: string,
  error: string,
  extra?: Record<string, unknown>,
): Promise<AgentJob> {
  const job = await prisma.agentJob.findUnique({ where: { id: jobId } });
  const existingMeta = (job?.metadata as Record<string, unknown>) || {};

  return prisma.agentJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      completedAt: new Date(),
      error,
      metadata: extra
        ? JSON.parse(JSON.stringify({ ...existingMeta, ...extra }))
        : undefined,
    },
  });
}

export async function listJobs(options?: {
  status?: JobStatus;
  assigneeAccountId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ jobs: AgentJob[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (options?.status) where.status = options.status;
  if (options?.assigneeAccountId) where.assigneeAccountId = options.assigneeAccountId;
  const [jobs, total] = await Promise.all([
    prisma.agentJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.agentJob.count({ where }),
  ]);
  return { jobs, total };
}

export async function deleteOldJobs(olderThanDays = 7): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await prisma.agentJob.deleteMany({
    where: {
      status: { in: [JobStatus.COMPLETED, JobStatus.FAILED] },
      completedAt: { lt: cutoff },
    },
  });

  return result.count;
}
