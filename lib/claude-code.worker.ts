import { AgentJob } from '@prisma/client';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { AgentResult } from './types';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

export async function execute(job: AgentJob): Promise<AgentResult> {
  const logCtx = {
    jobId: job.id,
    jiraIssueKey: job.jiraIssueKey,
    repository: job.repoPath,
  };

  const repoDir = job.repoPath;

  if (!fs.existsSync(repoDir)) {
    throw new Error(`Repository not found at ${repoDir}. Clone it first.`);
  }

  const metadata = (job.metadata as Record<string, string>) || {};
  const branchName = `agent/${job.jiraIssueKey.toLowerCase()}`;

  // 1. Checkout base branch and pull latest
  logger.log('Pulling latest from base branch', { ...logCtx, status: job.baseBranch });
  await git(repoDir, ['checkout', job.baseBranch]);
  await git(repoDir, ['pull', 'origin', job.baseBranch]);

  // 2. Create task branch
  logger.log(`Creating branch ${branchName}`, logCtx);
  try {
    await git(repoDir, ['checkout', '-b', branchName]);
  } catch {
    await git(repoDir, ['checkout', branchName]);
    await git(repoDir, ['reset', '--hard', `origin/${job.baseBranch}`]);
  }

  // 3. Run Claude Code
  const prompt = buildPrompt(job.jiraIssueKey, metadata);
  logger.log('Running Claude Code', logCtx);
  const claudeOutput = await runClaude(repoDir, prompt);

  // 4. Check if there are changes
  const { stdout: diffStat } = await git(repoDir, ['diff', '--stat']);
  const { stdout: statusOutput } = await git(repoDir, ['status', '--porcelain']);

  if (!diffStat.trim() && !statusOutput.trim()) {
    logger.warn('Claude Code made no changes', logCtx);
    return { success: false, error: 'No changes were made by Claude Code', claudeOutput };
  }

  // 5. Stage and commit
  logger.log('Committing changes', logCtx);
  await git(repoDir, ['add', '-A']);
  await git(repoDir, [
    'commit',
    '-m',
    `${job.jiraIssueKey}: ${metadata.summary || 'Agent implementation'}`,
  ]);

  // 6. Get diff stats after commit
  const { stdout: diffStats } = await git(repoDir, [
    'diff',
    '--stat',
    `origin/${job.baseBranch}...HEAD`,
  ]);

  // 7. Push
  logger.log('Pushing branch', logCtx);
  await git(repoDir, ['push', '-u', 'origin', branchName, '--force-with-lease']);

  // 8. Create PR
  logger.log('Creating pull request', logCtx);
  const prUrl = await createPR(repoDir, job, metadata, branchName, claudeOutput, diffStats.trim());

  logger.log('Agent execution completed', { ...logCtx, status: 'COMPLETED' });

  return {
    success: true,
    branchName,
    pullRequestUrl: prUrl || undefined,
    claudeOutput,
    diffStats: diffStats.trim(),
  };
}

function buildPrompt(issueKey: string, metadata: Record<string, string>): string {
  const parts = [`Implement the following Jira task:`, ``, `**Issue**: ${issueKey}`];

  if (metadata.summary) {
    parts.push(`**Summary**: ${metadata.summary}`);
  }
  if (metadata.description) {
    parts.push(`**Description**: ${metadata.description}`);
  }

  parts.push(
    ``,
    `Instructions:`,
    `1. Read the CLAUDE.md file if it exists for project conventions.`,
    `2. Implement the task described above.`,
    `3. Write tests for your changes.`,
    `4. Make sure all existing tests still pass.`,
    ``,
    `Decision handling:`,
    `- If you encounter ambiguity or multiple valid approaches, make the best judgment call based on codebase context and proceed with implementation.`,
    `- Do NOT stop or ask for clarification — always proceed.`,
    `- At the end of your work, output a section exactly like this:`,
    ``,
    `DECISIONS:`,
    `- <what you decided> — <why, and what to revert if wrong>`,
    ``,
    `NEEDS_REVIEW:`,
    `- <anything the reviewer should double-check>`,
  );

  return parts.join('\n');
}

function extractSection(output: string, header: string): string | null {
  const regex = new RegExp(`${header}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`);
  const match = output.match(regex);
  if (!match) return null;
  const content = match[1].trim();
  return content || null;
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

async function runClaude(cwd: string, prompt: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'claude',
      ['--print', '--dangerously-skip-permissions', '--verbose', prompt],
      {
        cwd,
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30 * 60 * 1000,
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'agent-orchestrator' },
      },
    );
    return stdout;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Claude Code execution failed: ${msg}`);
  }
}

async function createPR(
  cwd: string,
  job: AgentJob,
  metadata: Record<string, string>,
  branchName: string,
  claudeOutput: string,
  diffStats: string,
): Promise<string | null> {
  const decisions = extractSection(claudeOutput, 'DECISIONS');
  const needsReview = extractSection(claudeOutput, 'NEEDS_REVIEW');

  const title = `[${job.jiraIssueKey}] ${metadata.summary || 'Agent implementation'}`;
  const bodyParts = [
    `## ${job.jiraIssueKey}`,
    metadata.summary || '',
    '',
    metadata.description || '',
  ];

  if (decisions) {
    bodyParts.push('', '## Decisions Made', decisions);
  }

  if (needsReview) {
    bodyParts.push('', '## Needs Review', needsReview);
  }

  if (diffStats) {
    bodyParts.push('', '## Changes', '```', diffStats, '```');
  }

  bodyParts.push('', '---', `*Automated by Agent Orchestrator (Job: \`${job.id}\`)*`);

  const body = bodyParts.join('\n');

  try {
    logger.log(`Creating PR: base=${job.baseBranch} head=${branchName} repo=${cwd}`);
    const { stdout, stderr } = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', title, '--body', body, '--base', job.baseBranch, '--head', branchName],
      { cwd },
    );
    if (stderr) logger.warn(`gh pr create stderr: ${stderr}`);
    logger.log(`PR created: ${stdout.trim()}`);
    return stdout.trim();
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    logger.error(
      `Failed to create PR`,
      `stdout: ${execError.stdout || ''}\nstderr: ${execError.stderr || ''}\nmsg: ${execError.message || error}`,
    );
    return null;
  }
}
