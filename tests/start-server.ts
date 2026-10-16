import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { fixtureProvider } from './fixtures.js';

// Never import server/index or loadEnvironment here: automatic tests use no user key.
const directory = mkdtempSync(path.join(tmpdir(), 'planit-independent-qa-'));
const app = await createApp({ dbPath: path.join(directory, 'workspace.sqlite'), provider: fixtureProvider, allowedOrigins: ['http://127.0.0.1:4310', 'http://127.0.0.1:4311'] });
await app.listen({ host: '127.0.0.1', port: 4311 });
async function stop() {
  await app.close();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('planit-independent-qa-')) throw new Error('Unexpected QA cleanup path');
  rmSync(resolved, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
