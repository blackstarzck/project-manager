import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { createApp } from '../../server/app.js';
import type { AiRun, Project, WireElement } from '../../shared/schema.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { addFlowVersion, flattenElements, getProject, seedNestedProject, selectFlowVersion } from '../phase2-fixtures.js';

function selected(project: Project) {
  const version = project.flowGroups.flatMap(group => group.versions).find(version => version.id === project.selectedFlowVersionId);
  expect(version).toBeTruthy();
  return version!;
}

function assertProjection(project: Project) {
  const version = selected(project);
  expect(project.flow).toEqual(version.flow);
  expect(project.wireframes).toEqual(version.wireframes);
  expect(project.artifactRevisions.flow).toBe(version.flowRevision);
  expect(project.artifactRevisions.wireframes).toBe(version.wireframeRevision);
}

function assertReferences(project: Project) {
  const features = new Set(project.features.map(feature => feature.id));
  const allVersionIds = project.flowGroups.flatMap(group => group.versions.map(version => version.id));
  expect(new Set(allVersionIds).size).toBe(allVersionIds.length);
  for (const group of project.flowGroups) for (const version of group.versions) {
    expect(version.groupId).toBe(group.id);
    const nodeIds = new Set(version.flow.nodes.map(node => node.id));
    const screens = new Set(version.wireframes.map(screen => screen.id));
    for (const node of version.flow.nodes) for (const featureId of node.featureIds) expect(features.has(featureId)).toBeTruthy();
    for (const edge of version.flow.edges) { expect(nodeIds.has(edge.source)).toBeTruthy(); expect(nodeIds.has(edge.target)).toBeTruthy(); }
    for (const screen of version.wireframes) {
      if (screen.flowNodeId) expect(nodeIds.has(screen.flowNodeId)).toBeTruthy();
      const elements = flattenElements(screen.elements);
      expect(new Set(elements.map(element => element.id)).size).toBe(elements.length);
      for (const element of elements) {
        if (element.targetScreenId) expect(screens.has(element.targetScreenId)).toBeTruthy();
        if (element.targetElementId) expect(elements.find(target => target.id === element.targetElementId)?.type).toBe('modal');
      }
    }
  }
  assertProjection(project);
}

function allIds(project: Project) {
  return new Set([project.id, ...project.prd.map(item => item.id), ...project.features.map(item => item.id), ...project.flowGroups.flatMap(group => [group.id, ...group.versions.flatMap(version => [version.id, ...version.flow.nodes.map(node => node.id), ...version.flow.edges.map(edge => edge.id), ...version.flow.sections.map(section => section.id), ...version.wireframes.flatMap(screen => [screen.id, ...flattenElements(screen.elements).map(element => element.id)])])])]);
}

async function generate(request: APIRequestContext, project: Project, prompt: string): Promise<AiRun> {
  const response = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { artifact: 'wireframes', flowVersionId: project.selectedFlowVersionId, entityIds: [project.wireframes[0].id], prompt } });
  expect(response.status(), await response.text()).toBe(202);
  return response.json();
}

async function waitRun(request: APIRequestContext, run: AiRun, status: AiRun['status']) {
  let current = run;
  await expect.poll(async () => { current = await (await request.get(`${API}/ai/runs/${run.id}`)).json(); return current.status; }).toBe(status);
  return current;
}

test('N01/V01/V02: nested layouts survive reload, blank and copied versions stay independent', async ({ request }) => {
  const original = await seedNestedProject(request);
  assertReferences(original);
  expect((await getProject(request, original.id)).wireframes).toEqual(original.wireframes);
  const oldVersion = structuredClone(selected(original));
  let project = await addFlowVersion(request, original, { copy: true });
  expect(project.selectedFlowVersionId).not.toBe(original.selectedFlowVersionId);
  expect(selected(project).number).toBe(2);
  expect(project.flowGroups[0].versions.find(version => version.id === oldVersion.id)).toEqual(oldVersion);
  // IDs retain provenance across branches; versionId is the mutation isolation boundary.
  expect(project.flow.nodes[0].id).toBe(original.flow.nodes[0].id);
  expect(project.wireframes[0].id).toBe(original.wireframes[0].id);
  expect(flattenElements(project.wireframes[0].elements).map(element => element.text)).toEqual(flattenElements(original.wireframes[0].elements).map(element => element.text));
  assertReferences(project);
  const copiedVersion = project.selectedFlowVersionId!;
  project = await saveArtifact(request, project, 'flow', { ...project.flow, nodes: project.flow.nodes.map((node, index) => index === 1 ? { ...node, label: '복제 버전에서만 바꾼 검색' } : node) });
  expect(project.flowGroups[0].versions.find(version => version.id === oldVersion.id)).toEqual(oldVersion);
  project = await addFlowVersion(request, project, { group: true });
  expect(project.flowGroups).toHaveLength(2);
  expect(project.flow.nodes).toHaveLength(0);
  expect(project.wireframes).toHaveLength(0);
  project = await selectFlowVersion(request, project, copiedVersion);
  expect(project.flow.nodes[1].label).toBe('복제 버전에서만 바꾼 검색');
  assertProjection(await getProject(request, project.id));
  project = await selectFlowVersion(request, project, oldVersion.id);
  expect(project.flow).toEqual(original.flow);
  expect(project.wireframes).toEqual(original.wireframes);
});

test('N02: invalid deep trees, counts, IDs, actions and styles are rejected atomically', async ({ request }) => {
  const original = await seedNestedProject(request);
  const invalidTrees: WireElement[][] = [];
  const makeElement = (id: string): WireElement => ({ id, type: 'column', text: '', targetScreenId: null });
  let deepest = makeElement('depth-10');
  for (let index = 9; index >= 0; index--) deepest = { ...makeElement(`depth-${index}`), children: [deepest] };
  invalidTrees.push([deepest]);
  invalidTrees.push(Array.from({ length: 6 }, (_, row) => ({ ...makeElement(`row-${row}`), children: Array.from({ length: 85 }, (_, column) => makeElement(`child-${row}-${column}`)) })));
  invalidTrees.push([{ ...makeElement('duplicate'), children: [makeElement('duplicate')] }]);
  invalidTrees.push([{ ...makeElement('bad-screen'), type: 'button', action: 'navigate', targetScreenId: 'missing-screen' }]);
  invalidTrees.push([{ ...makeElement('bad-modal'), type: 'button', action: 'openModal', targetElementId: 'missing-modal' }]);
  invalidTrees.push([{ ...makeElement('unsafe-style'), style: { background: 'url(https://example.invalid/)' } }]);
  for (const elements of invalidTrees) {
    const response = await request.put(`${API}/projects/${original.id}/artifacts/wireframes`, { headers: mutationHeaders, data: { expectedRevision: original.artifactRevisions.wireframes, flowVersionId: original.selectedFlowVersionId, value: original.wireframes.map((screen, index) => index === 0 ? { ...screen, elements } : screen) } });
    expect(response.status(), await response.text()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    expect(await getProject(request, original.id)).toEqual(original);
  }
});

test('V04: inactive flow versions still protect their global feature references', async ({ request }) => {
  const original = await seedNestedProject(request);
  let project = await addFlowVersion(request, original);
  expect(project.flow.nodes).toHaveLength(0);
  const response = await request.put(`${API}/projects/${project.id}/artifacts/features`, { headers: mutationHeaders, data: { expectedRevision: project.artifactRevisions.features, value: [] } });
  expect(response.status(), await response.text()).toBeGreaterThanOrEqual(400);
  expect(response.status()).toBeLessThan(500);
  expect(await getProject(request, project.id)).toEqual(project);
});

test('N05/V06: previous-version proposal stays pending on context conflict and applies only in its version', async ({ request }) => {
  const original = await seedNestedProject(request);
  const run = await waitRun(request, await generate(request, original, '[QA_DELAY] 중첩 화면 한 개 개선'), 'succeeded');
  expect(run.flowVersionId).toBe(original.selectedFlowVersionId);
  let project = await addFlowVersion(request, original, { copy: true });
  const untouched = structuredClone(selected(project));
  const staleSave = await request.put(`${API}/projects/${project.id}/artifacts/wireframes`, { headers: mutationHeaders, data: { expectedRevision: original.artifactRevisions.wireframes, flowVersionId: original.selectedFlowVersionId, value: original.wireframes } });
  expect(staleSave.status()).toBe(409);
  const resolution = () => request.post(`${API}/proposals/${run.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } });
  const wrongContext = await resolution();
  expect(wrongContext.status(), await wrongContext.text()).toBe(409);
  expect(await wrongContext.text()).toContain('FLOW_CONTEXT_CONFLICT');
  const activity = await (await request.get(`${API}/projects/${project.id}/activity`)).json();
  expect(activity.proposals.find((proposal: { id: string }) => proposal.id === run.proposalId).status).toBe('pending');
  expect(await getProject(request, project.id)).toEqual(project);
  project = await selectFlowVersion(request, project, original.selectedFlowVersionId!);
  expect((await resolution()).ok()).toBeTruthy();
  project = await getProject(request, project.id);
  expect(project.wireframes[0].elements[0].text).toBe('AI가 수정한 화면 제목');
  expect(project.wireframes[0].elements[0].children).toEqual(original.wireframes[0].elements[0].children);
  expect(project.wireframes[1]).toEqual(original.wireframes[1]);
  expect(project.flowGroups.flatMap(group => group.versions).find(version => version.id === untouched.id)).toEqual(untouched);
  assertReferences(project);
});

test('V07: switching versions then cancelling keeps a late provider result cancelled', async ({ request }) => {
  const original = await seedNestedProject(request);
  const run = await generate(request, original, '[QA_DELAY] 버전을 바꾼 뒤 취소');
  const project = await addFlowVersion(request, original, { copy: true });
  const cancelled = await request.post(`${API}/ai/runs/${run.id}/cancel`, { headers: mutationHeaders, data: {} });
  expect(cancelled.ok()).toBeTruthy();
  await new Promise(resolve => setTimeout(resolve, 1900));
  const final = await waitRun(request, run, 'cancelled');
  expect(final.proposalId).toBeNull();
  expect(final.flowVersionId).toBe(original.selectedFlowVersionId);
  expect(await getProject(request, project.id)).toEqual(project);
});

test('N06: duplication and backup remap nested navigation across every flow version', async ({ request }) => {
  const original = await seedNestedProject(request);
  const project = await addFlowVersion(request, original, { copy: true, group: true });
  const backup = await (await request.get(`${API}/projects/${project.id}/backup`)).json();
  for (const response of [
    await request.post(`${API}/projects/${project.id}/duplicate`, { headers: mutationHeaders, data: {} }),
    await request.post(`${API}/backups/restore`, { headers: mutationHeaders, data: backup }),
  ]) {
    expect(response.ok(), await response.text()).toBeTruthy();
    const copy: Project = await response.json();
    expect(copy.flowGroups).toHaveLength(2);
    const sourceIds = allIds(project);
    for (const id of allIds(copy)) expect(sourceIds.has(id), `Copied entity reused original ID ${id}`).toBeFalsy();
    assertReferences(copy);
    expect(copy.flowGroups.map(group => group.versions.map(version => version.wireframes.map(screen => flattenElements(screen.elements).map(element => element.text))))).toEqual(project.flowGroups.map(group => group.versions.map(version => version.wireframes.map(screen => flattenElements(screen.elements).map(element => element.text)))));
  }
  const directory = mkdtempSync(path.join(tmpdir(), 'planit-qa-nested-restore-'));
  const dbPath = path.join(directory, 'restored.sqlite');
  const provider = { configured: false, model: 'qa-no-ai', generate: async () => { throw new Error('Backup restore must never call AI'); } };
  let app = await createApp({ dbPath, provider });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: mutationHeaders, payload: backup });
    expect(response.statusCode, response.body).toBe(201);
    const restored = response.json<Project>();
    assertReferences(restored);
    await app.close();
    app = await createApp({ dbPath, provider });
    const reopened = (await app.inject(`/api/projects/${restored.id}`)).json<Project>();
    expect(reopened).toEqual(restored);
    assertReferences(reopened);
  } finally {
    await app.close();
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('planit-qa-nested-restore-')) throw new Error('Unexpected QA cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  }
});

test('V02/V03: legacy SQLite migrates without changing document IDs or revisions and persists selection after restart', async ({ request }) => {
  const original = await seedNestedProject(request);
  // Build an actual pre-version row instead of testing a round trip through the new schema.
  const { flowGroups: _groups, selectedFlowVersionId: _selection, selectedWireframeVersionId: _wireframeSelection, ...legacy } = original;
  const directory = mkdtempSync(path.join(tmpdir(), 'planit-qa-legacy-'));
  const dbPath = path.join(directory, 'legacy.sqlite');
  const provider = { configured: false, model: 'qa-no-ai', generate: async () => { throw new Error('Migration must never call AI'); } };
  let app = await createApp({ dbPath, provider });
  await app.close();
  const db = new DatabaseSync(dbPath);
  db.prepare('INSERT INTO projects(id,data) VALUES(?,?)').run(original.id, JSON.stringify(legacy));
  db.prepare('INSERT INTO revisions(id,project_id,revision,created_at,label,data) VALUES(?,?,?,?,?,?)').run(randomUUID(), original.id, original.revision, original.createdAt, '이전 앱에서 저장', JSON.stringify(legacy));
  db.close();
  app = await createApp({ dbPath, provider });
  try {
    let migrated = (await app.inject(`/api/projects/${original.id}`)).json<Project>();
    expect(migrated.flowGroups).toHaveLength(1);
    expect(migrated.flowGroups[0].versions).toHaveLength(1);
    expect(migrated.flow).toEqual(original.flow);
    expect(migrated.wireframes).toEqual(original.wireframes);
    expect(migrated.artifactRevisions).toEqual(original.artifactRevisions);
    expect(migrated.revision).toBe(original.revision);
    assertReferences(migrated);
    const created = await app.inject({ method: 'POST', url: `/api/projects/${original.id}/flow-groups`, headers: mutationHeaders, payload: { name: '재시작 후 선택 유지', expectedRevision: migrated.revision } });
    expect(created.statusCode, created.body).toBeLessThan(300);
    migrated = created.json<Project>();
    await app.close();
    app = await createApp({ dbPath, provider });
    expect((await app.inject(`/api/projects/${original.id}`)).json<Project>()).toEqual(migrated);
  } finally {
    await app.close();
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('planit-qa-legacy-')) throw new Error('Unexpected QA cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  }
});
