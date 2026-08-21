import * as fs from 'fs';
import * as path from 'path';
import { RepositoryMapping } from './types';

let cachedMappings: Record<string, RepositoryMapping> | null = null;

export function resolveRepository(projectKey: string): RepositoryMapping | null {
  const mappings = getMappings();
  return mappings[projectKey] || null;
}

function getMappings(): Record<string, RepositoryMapping> {
  if (cachedMappings) return cachedMappings;

  // Env var takes precedence
  const envMappings = process.env.REPO_MAPPINGS;
  if (envMappings) {
    cachedMappings = JSON.parse(envMappings);
    return cachedMappings!;
  }

  // Fall back to repos.json
  const configPath = path.resolve(process.cwd(), 'repos.json');
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    cachedMappings = JSON.parse(raw);
    return cachedMappings!;
  }

  cachedMappings = {};
  return cachedMappings;
}

export function reloadMappings(): void {
  cachedMappings = null;
}
