import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { createApp } from '../../server/app.js';
import type { Project, ProjectActivity, Revision } from '../../shared/schema.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { addFlowVersion, flattenElements, getProject, seedNestedProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, addWireVersion, allFlows, allWireVersions, assertWireProjection, awaitRun, runProposal, wirePath, wireRun } from '../phase4-fixtures.js';

const provider = { configured: false, model: 'qa-no-ai', generate: async () => { throw new Error('Persistence QA must never call AI'); } };
function temporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'planit-qa-wire-'));
  return { dbPath: path.join(directory, 'workspace.sqlite'), cleanup() {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('planit-qa-wire-')) throw new Error('Unexpected QA cleanup path');
    rmSync(resolved, { recursive: true, force: true });
  } };
}
function ids(project: Project) {
  return new Set([project.id, ...project.prd.map(item => item.id), ...project.features.map(item => item.id), ...project.flowGroups.map(group => group.id), ...allFlows(project).flatMap(flow => [flow.id, ...flow.flow.nodes.map(node => node.id), ...flow.flow.edges.map(edge => edge.id), ...flow.flow.sections.map(section => section.id), ...flow.wireframeVersions.flatMap(version => [version.id, ...version.wireframes.flatMap(screen => [screen.id, ...flattenElements(screen.elements).map(element => element.id)])])])]);
}
function assertAllReferences(project: Project) {
  const versionIds = allWireVersions(project).map(version => version.id);
  expect(new Set(versionIds).size).toBe(versionIds.length);
  for (const flow of allFlows(project)) for (const version of flow.wireframeVersions) {
    expect(version.flowVersionId).toBe(flow.id);
    const screenIds = new Set(version.wireframes.map(screen => screen.id));
    for (const screen of version.wireframes) {
      if (screen.flowNodeId) expect(flow.flow.nodes.some(node => node.id === screen.flowNodeId)).toBeTruthy();
      const elements = flattenElements(screen.elements);
      expect(new Set(elements.map(element => element.id)).size).toBe(elements.length);
      for (const element of elements) {
        if (element.targetScreenId) expect(screenIds.has(element.targetScreenId)).toBeTruthy();
        if (element.targetElementId) expect(elements.find(target => target.id === element.targetElementId)?.type).toBe('modal');
      }
    }
  }
  assertWireProjection(project);
}

test('WP01: real v2 SQLite migration binds pending proposals to their originating flow and persists screen histories after restart', async ({ request }) => {
  const original = await seedNestedProject(request);
  const run = await awaitRun(request, await wireRun(request, original, 'edit', '기존 앱의 승인 대기 화면', [original.wireframes[0].id]));
  const proposal = await runProposal(request, run);
  const other = await addFlowVersion(request, original, { copy: true, name: '마지막으로 선택한 다른 플로우' });
  const { selectedWireframeVersionId: _topSelection, ...top } = other;
  const legacy = { ...top, flowGroups: top.flowGroups.map(({ archivedAt: _archivedGroup, ...group }) => ({ ...group, versions: group.versions.map(({ wireframeVersions: _history, selectedWireframeVersionId: _selection, archivedAt: _archivedFlow, ...flow }) => flow) })) };
  const { wireframeVersionId: _runContext, wireframeGenerationMode: _runMode, ...oldRun } = run;
  const { wireframeVersionId: _proposalContext, wireframeGenerationMode: _proposalMode, ...oldProposal } = proposal;
  const temporary = temporaryDatabase();
  let app = await createApp({ dbPath: temporary.dbPath, provider });
  await app.close();
  const database = new DatabaseSync(temporary.dbPath);
  database.prepare('INSERT INTO projects(id,data) VALUES(?,?)').run(original.id, JSON.stringify(legacy));
  database.prepare('INSERT INTO runs(id,project_id,data) VALUES(?,?,?)').run(run.id, original.id, JSON.stringify(oldRun));
  database.prepare('INSERT INTO proposals(id,project_id,data) VALUES(?,?,?)').run(proposal.id, original.id, JSON.stringify(oldProposal));
  database.exec('PRAGMA user_version=2');
  database.close();
  app = await createApp({ dbPath: temporary.dbPath, provider });
  try {
    const migrated = (await app.inject(`/api/projects/${original.id}`)).json<Project>();
    expect(migrated.revision).toBe(other.revision);
    expect(migrated.artifactRevisions).toEqual(other.artifactRevisions);
    expect(allFlows(migrated).map(flow => flow.wireframes)).toEqual(allFlows(other).map(flow => flow.wireframes));
    expect(allWireVersions(migrated)).toHaveLength(2);
    const originWireId = allFlows(migrated).find(flow => flow.id === original.selectedFlowVersionId)!.selectedWireframeVersionId;
    expect(originWireId).not.toBe(migrated.selectedWireframeVersionId);
    const activity = (await app.inject(`/api/projects/${original.id}/activity`)).json<ProjectActivity>();
    expect(activity.runs[0].wireframeVersionId).toBe(originWireId);
    expect(activity.proposals[0].wireframeVersionId).toBe(originWireId);
    const mismatch = await app.inject({ method: 'POST', url: `/api/proposals/${proposal.id}/resolve`, headers: mutationHeaders, payload: { action: 'approve', commandId: randomUUID() } });
    expect(mismatch.statusCode).toBe(409);
    const selected = await app.inject({ method: 'POST', url: `/api/projects/${original.id}/flow-versions/${original.selectedFlowVersionId}/wireframe-versions/${originWireId}/select`, headers: mutationHeaders, payload: { expectedRevision: migrated.revision } });
    expect(selected.statusCode, selected.body).toBe(200);
    const applied = await app.inject({ method: 'POST', url: `/api/proposals/${proposal.id}/resolve`, headers: mutationHeaders, payload: { action: 'approve', commandId: randomUUID() } });
    expect(applied.statusCode, applied.body).toBe(200);
    const saved = (await app.inject(`/api/projects/${original.id}`)).json<Project>();
    expect(saved.wireframes[0].elements[0].text).toBe('AI가 수정한 화면 제목');
    expect(allFlows(saved).find(flow => flow.id === other.selectedFlowVersionId)?.wireframes).toEqual(other.wireframes);
    assertAllReferences(saved);
    await app.close();
    app = await createApp({ dbPath: temporary.dbPath, provider });
    expect((await app.inject(`/api/projects/${original.id}`)).json<Project>()).toEqual(saved);
    const check = new DatabaseSync(temporary.dbPath);
    expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
    check.close();
  } finally { await app.close(); temporary.cleanup(); }
});

test('WP02: duplicate and backup remap every archived screen history and nested reference, then survive SQLite restart', async ({ request }) => {
  const original = await seedNestedProject(request);
  let project = await addWireVersion(request, original, true, '보존할 이전 화면');
  const archivedId = project.selectedWireframeVersionId!;
  project = await saveArtifact(request, project, 'wireframes', project.wireframes.map((screen, index) => index === 0 ? { ...screen, name: '독립적으로 수정된 화면 기록' } : screen));
  const archived = await request.post(`${wirePath(project)}/${archivedId}/archive`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(archived.ok(), await archived.text()).toBeTruthy(); project = await archived.json();
  project = await addFlowVersion(request, project, { copy: true, group: true });
  const backup = await (await request.get(`${API}/projects/${project.id}/backup`)).json();
  const content = (p: Project) => allFlows(p).map(flow => flow.wireframeVersions.map(version => ({ archived: !!version.archivedAt, name: version.name, screens: version.wireframes.map(screen => ({ name: screen.name, elements: flattenElements(screen.elements).map(element => element.text) })) })));
  const sourceIds = ids(project);
  for (const response of [await request.post(`${API}/projects/${project.id}/duplicate`, { headers: mutationHeaders, data: {} }), await request.post(`${API}/backups/restore`, { headers: mutationHeaders, data: backup })]) {
    expect(response.ok(), await response.text()).toBeTruthy();
    const copy = await response.json() as Project;
    expect(content(copy)).toEqual(content(project));
    for (const id of ids(copy)) expect(sourceIds.has(id), `Reused source identity: ${id}`).toBeFalsy();
    assertAllReferences(copy);
  }
  const temporary = temporaryDatabase();
  let app = await createApp({ dbPath: temporary.dbPath, provider });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: mutationHeaders, payload: backup });
    expect(response.statusCode, response.body).toBe(201);
    const restored = response.json<Project>();
    expect(content(restored)).toEqual(content(project)); assertAllReferences(restored);
    await app.close(); app = await createApp({ dbPath: temporary.dbPath, provider });
    expect((await app.inject(`/api/projects/${restored.id}`)).json<Project>()).toEqual(restored);
  } finally { await app.close(); temporary.cleanup(); }
});

test('WP03: project snapshot restore creates a distinct visual branch and retains all existing screen histories', async ({ request }) => {
  const original = await seedNestedProject(request);
  const revisions = await (await request.get(`${API}/projects/${original.id}/revisions`)).json() as Revision[];
  const snapshot = revisions.find(revision => revision.revision === original.revision)!;
  let project = await addWireVersion(request, original);
  project = await saveArtifact(request, project, 'wireframes', project.wireframes.map((screen, index) => index === 0 ? { ...screen, name: '복원 후에도 보존할 최신 화면' } : screen));
  const response = await request.post(`${API}/projects/${original.id}/revisions/${snapshot.id}/restore`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const restored = await response.json() as Project;
  for (const previous of allFlows(project)) expect(allFlows(restored).find(flow => flow.id === previous.id)).toEqual(previous);
  expect(restored.selectedFlowVersionId).not.toBe(project.selectedFlowVersionId);
  expect(activeFlow(restored).wireframeVersions).toHaveLength(1);
  expect(allWireVersions(project).some(version => version.id === restored.selectedWireframeVersionId)).toBeFalsy();
  expect(restored.wireframes.map(screen => screen.elements)).toEqual(original.wireframes.map(screen => screen.elements));
  assertAllReferences(restored);
});
