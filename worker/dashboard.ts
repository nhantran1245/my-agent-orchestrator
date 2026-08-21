import * as http from 'http';
import { getJob, listJobs } from '../lib/jobs.service';
import { AppError, ErrorCode } from '../lib/errors';
import { logger } from '../lib/logger';
import { AgentJob } from '@prisma/client';

export function startDashboard(port: number, workerUserId: string): void {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    try {
      if (url.pathname === '/dashboard' || url.pathname === '/dashboard/') {
        await handleIndex(res, workerUserId);
      } else if (url.pathname.startsWith('/dashboard/jobs/')) {
        const id = url.pathname.replace('/dashboard/jobs/', '');
        await handleJobDetail(res, id);
      } else {
        res.writeHead(302, { Location: '/dashboard' });
        res.end();
      }
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  server.listen(port, () => {
    logger.log(`Dashboard running at http://localhost:${port}/dashboard`);
  });
}

async function handleIndex(res: http.ServerResponse, workerUserId: string): Promise<void> {
  const { jobs } = await listJobs({ assigneeAccountId: workerUserId, limit: 100 });

  const rows = jobs
    .map((job) => {
      const meta = (job.metadata as Record<string, string>) || {};
      const duration = formatDuration(job.startedAt, job.completedAt);
      const statusBadge = `<span class="badge badge-${job.status.toLowerCase()}">${job.status}</span>`;
      const prLink = meta.pullRequestUrl
        ? `<a href="${escapeHtml(meta.pullRequestUrl)}" target="_blank">PR</a>`
        : '—';

      return `<tr class="job-row" data-id="${job.id}">
        <td><code>${job.id.slice(0, 8)}</code></td>
        <td><strong>${escapeHtml(job.jiraIssueKey)}</strong><br><small>${escapeHtml(meta.summary || '')}</small></td>
        <td>${statusBadge}</td>
        <td>${prLink}</td>
        <td>${escapeHtml((job.repoPath || '').split('/').pop() || '—')}</td>
        <td>${duration}</td>
        <td>${formatDate(job.createdAt)}</td>
      </tr>`;
    })
    .join('\n');

  const html = renderPage(rows, workerUserId);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleJobDetail(res: http.ServerResponse, id: string): Promise<void> {
  let job: AgentJob;
  try {
    job = await getJob(id);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.JOB_NOT_FOUND) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Job not found');
      return;
    }
    throw error;
  }

  const meta = (job.metadata as Record<string, string>) || {};

  const html = `<!DOCTYPE html>
<html><head>
<title>Job ${job.jiraIssueKey}</title>
<style>${css()}</style>
</head><body>
<div class="container">
  <a href="/dashboard">&larr; Back</a>
  <h1>${escapeHtml(job.jiraIssueKey)} <span class="badge badge-${job.status.toLowerCase()}">${job.status}</span></h1>
  <p><strong>Summary:</strong> ${escapeHtml(meta.summary || '—')}</p>
  <table class="detail-table">
    <tr><td>Job ID</td><td><code>${job.id}</code></td></tr>
    <tr><td>Project</td><td>${escapeHtml(job.jiraProjectKey)}</td></tr>
    <tr><td>Repository</td><td>${escapeHtml(job.repoPath || '—')}</td></tr>
    <tr><td>Base Branch</td><td>${escapeHtml(job.baseBranch || '—')}</td></tr>
    <tr><td>Branch</td><td>${escapeHtml(meta.branchName || '—')}</td></tr>
    <tr><td>PR</td><td>${meta.pullRequestUrl ? `<a href="${escapeHtml(meta.pullRequestUrl)}" target="_blank">${escapeHtml(meta.pullRequestUrl)}</a>` : '—'}</td></tr>
    <tr><td>Created</td><td>${formatDate(job.createdAt)}</td></tr>
    <tr><td>Started</td><td>${job.startedAt ? formatDate(job.startedAt) : '—'}</td></tr>
    <tr><td>Completed</td><td>${job.completedAt ? formatDate(job.completedAt) : '—'}</td></tr>
    <tr><td>Duration</td><td>${formatDuration(job.startedAt, job.completedAt)}</td></tr>
  </table>

  ${job.error ? `<h3>Error</h3><pre class="error">${escapeHtml(job.error)}</pre>` : ''}

  ${meta.diffStats ? `<h3>Diff Stats</h3><pre>${escapeHtml(meta.diffStats)}</pre>` : ''}

  ${meta.claudeOutput ? `<h3>Claude Output</h3><pre class="claude-output">${escapeHtml(meta.claudeOutput)}</pre>` : ''}
</div>
</body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderPage(rows: string, workerUserId: string): string {
  return `<!DOCTYPE html>
<html><head>
<title>Agent Orchestrator — ${workerUserId}</title>
<meta http-equiv="refresh" content="10">
<style>${css()}</style>
</head><body>
<div class="container">
  <h1>Agent Orchestrator</h1>
  <p class="subtitle">Worker: <code>${escapeHtml(workerUserId)}</code></p>
  <table>
    <thead>
      <tr>
        <th>Job</th>
        <th>Issue</th>
        <th>Status</th>
        <th>PR</th>
        <th>Repo</th>
        <th>Duration</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:2rem">No jobs yet</td></tr>'}</tbody>
  </table>
</div>
<script>
document.querySelectorAll('.job-row').forEach(row => {
  row.style.cursor = 'pointer';
  row.addEventListener('click', () => {
    window.location = '/dashboard/jobs/' + row.dataset.id;
  });
});
</script>
</body></html>`;
}

function css(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .container { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
    h1 { margin-bottom: 0.5rem; }
    h3 { margin: 1.5rem 0 0.5rem; }
    .subtitle { color: #666; margin-bottom: 1.5rem; }
    a { color: #0366d6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #24292e; color: #fff; text-align: left; padding: 0.75rem 1rem; font-weight: 500; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #eee; }
    tr:hover { background: #f8f9fa; }
    code { background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.85rem; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; max-height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
    pre.error { background: #2d1b1b; color: #f88; }
    pre.claude-output { background: #1a2332; color: #aed6f1; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .badge-pending { background: #fef3cd; color: #856404; }
    .badge-queued { background: #d1ecf1; color: #0c5460; }
    .badge-running { background: #cce5ff; color: #004085; }
    .badge-completed { background: #d4edda; color: #155724; }
    .badge-failed { background: #f8d7da; color: #721c24; }
    .detail-table td:first-child { font-weight: 600; width: 140px; }
    small { color: #666; }
  `;
}

function formatDuration(start: Date | null, end: Date | null): string {
  if (!start) return '—';
  const endTime = end || new Date();
  const ms = endTime.getTime() - start.getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
