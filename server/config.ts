import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';

export function loadEnvironment(directory = process.cwd()) {
  // Node's loader preserves values already supplied by the parent environment.
  for (const filename of ['.env', '.env.txt']) {
    const file = path.join(directory, filename);
    if (existsSync(file)) loadEnvFile(file);
  }
}

export function defaultDataDirectory() {
  return process.env.PM_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'ProjectManager', 'data');
}

export function ensureDataDirectory(directory: string) {
  mkdirSync(directory, { recursive: true });
  return path.join(directory, 'workspace.sqlite');
}
