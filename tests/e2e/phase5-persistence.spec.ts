import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createApp } from '../../server/app.js';
import type { AiRun, Project } from '../../shared/schema.js';
import { API, fixtureProvider, mutationHeaders, saveArtifact } from '../fixtures.js';
import { flattenElements, getProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, addWireVersion, allWireVersions } from '../phase4-fixtures.js';
import { linkedHeaders, seedThreePageProject } from '../phase5-fixtures.js';

function temporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'planit-qa-pages-'));
  return { dbPath: path.join(directory, 'workspace.sqlite'), cleanup() {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('planit-qa-pages-')) throw new Error('Unexpected QA cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  } };
}

test('PP01: persisted successful page outputs survive SQLite restart and model guard before explicit failed-only retry', async ({ request }) => {
  const original = await seedThreePageProject(request);
  const backup = await (await request.get(`${API}/projects/${original.id}/backup`)).json();
  const temporary = temporaryDatabase(), calls: string[] = [];
  const provider = { ...fixtureProvider, generate: async (input: Parameters<typeof fixtureProvider.generate>[0]) => { calls.push(JSON.parse(input.prompt).pageTask.pageId); return fixtureProvider.generate(input); } };
  let app = await createApp({ dbPath: temporary.dbPath, provider });
  try {
    const imported = (await app.inject({ method: 'POST', url: '/api/backups/restore', headers: mutationHeaders, payload: backup })).json<Project>();
    const failedPage = imported.wireframes[1].flowNodeId!;
    const started = await app.inject({ method: 'POST', url: `/api/projects/${imported.id}/ai/runs`, headers: mutationHeaders, payload: { artifact: 'wireframes', prompt: `[QA_FAIL_ONCE:${failedPage}] 재시작 보존`, entityIds: imported.wireframes.slice(0, 2).map(screen => screen.id), flowVersionId: imported.selectedFlowVersionId, wireframeVersionId: imported.selectedWireframeVersionId, wireframeGenerationMode: 'regenerate' } });
    expect(started.statusCode, started.body).toBe(202);
    const id = started.json<AiRun>().id;
    await expect.poll(async () => (await app.inject(`/api/ai/runs/${id}`)).json<AiRun>().status).toBe('succeeded');
    const first = (await app.inject(`/api/ai/runs/${id}`)).json<AiRun>();
    expect(first.pageSummary?.failed).toBe(1); expect(calls).toHaveLength(2);
    await app.close(); app = await createApp({ dbPath: temporary.dbPath, provider: { ...provider, model: 'different-qa-model' } });
    expect((await app.inject(`/api/ai/runs/${id}`)).json()).toEqual(first);
    const blocked = await app.inject({ method: 'POST', url: `/api/ai/runs/${id}/retry-pages`, headers: mutationHeaders, payload: { commandId: randomUUID() } });
    expect(blocked.statusCode).toBe(409); expect(blocked.body).toContain('MODEL_CHANGED');
    expect((await app.inject(`/api/ai/runs/${id}`)).json()).toEqual(first); expect(calls).toHaveLength(2);
    await app.close(); app = await createApp({ dbPath: temporary.dbPath, provider });
    const retried = await app.inject({ method: 'POST', url: `/api/ai/runs/${id}/retry-pages`, headers: mutationHeaders, payload: { commandId: randomUUID(), pageTaskIds: [first.pageTasks![1].id] } });
    expect(retried.statusCode, retried.body).toBe(202);
    await expect.poll(async () => (await app.inject(`/api/ai/runs/${id}`)).json<AiRun>().status).toBe('succeeded');
    const done = (await app.inject(`/api/ai/runs/${id}`)).json<AiRun>();
    expect(done.pageSummary).toEqual({ total: 2, succeeded: 2, failed: 0, cancelled: 0 });
    expect(done.pageTasks![0]).toEqual(first.pageTasks![0]);
    expect(calls).toEqual([imported.wireframes[0].flowNodeId, failedPage, failedPage]);
    expect((await app.inject(`/api/projects/${imported.id}`)).json()).toEqual(imported);
  } finally { await app.close(); temporary.cleanup(); }
});

test('PP02: navigation bindings stay local to copied versions and remap through clone, backup and SQLite restart', async ({ request }) => {
  let original = await seedThreePageProject(request);
  original = await saveArtifact(request, original, 'wireframes', linkedHeaders(original, [1, 2]));
  let copied = await addWireVersion(request, original);
  const screens = structuredClone(copied.wireframes); screens[0].elements[0].text = '사본에서만 바뀐 공통 헤더';
  copied = await saveArtifact(request, copied, 'wireframes', screens);
  expect(activeFlow(copied).wireframeVersions[0]).toEqual(activeWire(original));
  expect(copied.wireframes[1].elements[0].text).toBe('사본에서만 바뀐 공통 헤더');
  const backup = await (await request.get(`${API}/projects/${copied.id}/backup`)).json();
  const originalScreenIds = new Set(copied.wireframes.map(screen => screen.id));
  const originalElementIds = new Set(copied.wireframes.flatMap(screen => flattenElements(screen.elements).map(element => element.id)));
  const validateBindings = (project: Project) => {
    for (const version of allWireVersions(project)) for (const target of version.wireframes) {
      for (const binding of Object.values(target.navigationSync || {})) {
        const source = version.wireframes.find(screen => screen.id === binding!.sourceScreenId)!;
        expect(source).toBeTruthy(); expect(originalScreenIds.has(source.id)).toBe(false);
        const sourceElements = flattenElements(source.elements), targetElements = flattenElements(target.elements);
        expect(sourceElements.find(element => element.id === binding!.sourceElementId)?.type).toBe('header');
        for (const [sourceId, targetId] of Object.entries(binding!.elementIdMap)) {
          expect(originalElementIds.has(sourceId)).toBe(false); expect(originalElementIds.has(targetId)).toBe(false);
          expect(sourceElements.some(element => element.id === sourceId)).toBe(true);
          expect(targetElements.some(element => element.id === targetId)).toBe(true);
        }
      }
    }
  };
  const cloned = await request.post(`${API}/projects/${copied.id}/duplicate`, { headers: mutationHeaders, data: {} });
  expect(cloned.ok(), await cloned.text()).toBeTruthy(); validateBindings(await cloned.json());
  const temporary = temporaryDatabase();
  let app = await createApp({ dbPath: temporary.dbPath, provider: { ...fixtureProvider, configured: false } });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: mutationHeaders, payload: backup });
    expect(response.statusCode, response.body).toBe(201); const restored = response.json<Project>(); validateBindings(restored);
    await app.close(); app = await createApp({ dbPath: temporary.dbPath, provider: { ...fixtureProvider, configured: false } });
    expect((await app.inject(`/api/projects/${restored.id}`)).json()).toEqual(restored);
  } finally { await app.close(); temporary.cleanup(); }
  expect(await getProject(request, original.id)).toEqual(copied);
});
