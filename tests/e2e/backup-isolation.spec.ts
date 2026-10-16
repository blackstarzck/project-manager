import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createApp } from '../../server/app.js';
import type { Project } from '../../shared/schema.js';
import { API, mutationHeaders, seedProject } from '../fixtures.js';

test('Q16: restore backup into a fresh database and reopen it with all cross-document references intact', async ({ request }) => {
  const original = await seedProject(request);
  const backup = await (await request.get(`${API}/projects/${original.id}/backup`)).json();
  const directory = mkdtempSync(path.join(tmpdir(), 'planit-qa-restore-'));
  const dbPath = path.join(directory, 'fresh-workspace.sqlite');
  const provider = { configured: false, model: 'qa-no-ai', generate: async () => { throw new Error('Backup restore must never call AI'); } };
  let app = await createApp({ dbPath, provider });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: mutationHeaders, payload: backup });
    expect(response.statusCode, response.body).toBe(201);
    const restored = response.json<Project>();
    expect(restored.id).not.toBe(original.id);
    await app.close();
    app = await createApp({ dbPath, provider });
    const reopened = (await app.inject(`/api/projects/${restored.id}`)).json<Project>();
    expect(reopened).toEqual(restored);
    expect(reopened.prd[0].content).toBe(original.prd[0].content);
    expect(reopened.features[0].prdIds).toContain(reopened.prd[0].id);
    expect(reopened.features[2].parentId).toBe(reopened.features[1].id);
    expect(reopened.flow.edges[1].target).toBe(reopened.flow.nodes[2].id);
    expect(reopened.flow.nodes[1].featureIds).toContain(reopened.features[1].id);
    expect(reopened.wireframes[0].flowNodeId).toBe(reopened.flow.nodes[1].id);
    expect(reopened.wireframes[0].elements[2].targetScreenId).toBe(reopened.wireframes[1].id);
    expect((await app.inject(`/api/projects/${original.id}`)).statusCode).toBe(404);
  } finally {
    await app.close();
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('planit-qa-restore-')) throw new Error('Unexpected QA cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  }
});
