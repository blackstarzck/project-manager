import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Project, Proposal } from '../../shared/schema.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { addFlowVersion, getProject, seedNestedProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, addWireVersion, allWireVersions, assertWireProjection, awaitRun, runProposal, selectWireVersion, wirePath, wireRun } from '../phase4-fixtures.js';

test('WV01: copied and blank wireframe versions isolate equal screen IDs and enforce both context IDs', async ({ request }) => {
  const original = await seedNestedProject(request);
  const first = activeWire(original);
  let project = await addWireVersion(request, original);
  const secondId = project.selectedWireframeVersionId!;
  expect(secondId).not.toBe(first.id);
  expect(project.wireframes).toEqual(original.wireframes);
  expect(activeFlow(project).wireframeVersions.find(version => version.id === first.id)).toEqual(first);
  assertWireProjection(project);
  const stale = await request.put(`${API}/projects/${project.id}/artifacts/wireframes`, { headers: mutationHeaders, data: { expectedRevision: original.artifactRevisions.wireframes, flowVersionId: original.selectedFlowVersionId, wireframeVersionId: first.id, value: original.wireframes } });
  expect(stale.status()).toBe(409);
  expect(await stale.text()).toContain('WIREFRAME_CONTEXT');
  expect(await getProject(request, project.id)).toEqual(project);
  project = await saveArtifact(request, project, 'wireframes', project.wireframes.map((screen, index) => index === 0 ? { ...screen, name: '사본에서만 수정한 화면' } : screen));
  expect(activeFlow(project).wireframeVersions.find(version => version.id === first.id)).toEqual(first);
  const editedCopy = activeWire(project);
  project = await addWireVersion(request, project, false, '빈 화면 기획');
  expect(project.wireframes).toEqual([]);
  assertWireProjection(project);
  const invalidFlow = await request.put(`${API}/projects/${project.id}/artifacts/flow`, { headers: mutationHeaders, data: { expectedRevision: project.artifactRevisions.flow, flowVersionId: project.selectedFlowVersionId, value: { ...project.flow, nodes: project.flow.nodes.filter(node => node.id !== original.wireframes[0].flowNodeId), edges: [] } } });
  expect(invalidFlow.status()).toBe(400);
  expect(await getProject(request, project.id)).toEqual(project);
  project = await selectWireVersion(request, project, secondId);
  expect(activeWire(project)).toEqual(editedCopy);
  project = await selectWireVersion(request, project, first.id);
  expect(project.wireframes).toEqual(original.wireframes);
  const copiedFlow = await addFlowVersion(request, project, { copy: true });
  const newWireIds = activeFlow(copiedFlow).wireframeVersions.map(version => version.id);
  expect(newWireIds).toHaveLength(3);
  expect(newWireIds.every(id => !activeFlow(project).wireframeVersions.some(version => version.id === id))).toBeTruthy();
  expect(copiedFlow.wireframes).toEqual(original.wireframes);
});

test('WV02: scoped regeneration forks only on approval, preserves origin/unselected screen, and duplicate approval creates once', async ({ request }) => {
  const original = await seedNestedProject(request);
  const source = activeWire(original);
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', '선택 화면의 새 수정본', [original.wireframes[0].id]));
  expect(run.wireframeVersionId).toBe(source.id);
  expect(run.wireframeGenerationMode).toBe('regenerate');
  const proposal = await runProposal(request, run);
  expect(proposal.changes).toHaveLength(1);
  expect(proposal.status).toBe('pending');
  expect(await getProject(request, original.id)).toEqual(original);
  const commandId = randomUUID();
  const approve = (id = commandId) => request.post(`${API}/proposals/${run.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: id } });
  const response = await approve();
  expect(response.ok(), await response.text()).toBeTruthy();
  const result = await response.json() as { project: Project; proposal: Proposal };
  expect(result.project.selectedFlowVersionId).toBe(original.selectedFlowVersionId);
  expect(result.project.selectedWireframeVersionId).not.toBe(source.id);
  expect(result.proposal.resultWireframeVersionId).toBe(result.project.selectedWireframeVersionId);
  expect(activeFlow(result.project).wireframeVersions.find(version => version.id === source.id)).toEqual(source);
  expect(result.project.wireframes[1]).toEqual(original.wireframes[1]);
  expect(result.project.wireframes[0].elements[0].text).toBe('AI가 수정한 화면 제목');
  expect(result.project.wireframes[0].elements[0].children).toEqual(original.wireframes[0].elements[0].children);
  assertWireProjection(result.project);
  expect((await approve()).ok()).toBeTruthy();
  expect((await approve(randomUUID())).ok()).toBeTruthy();
  expect(await getProject(request, original.id)).toEqual(result.project);
});

test('WV03: append selects missing pages and never rewrites existing screens or makes a destination before approval', async ({ request }) => {
  const original = await seedNestedProject(request);
  const pageId = `${original.id}-new-page`;
  const project = await saveArtifact(request, original, 'flow', { ...original.flow, nodes: [...original.flow.nodes, { id: pageId, type: 'page', label: '신규 예약 현황', description: '', position: { x: 700, y: 0 }, featureIds: [], sectionId: null }] });
  const wrong = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { artifact: 'wireframes', prompt: '이미 있는 페이지 추가', entityIds: [project.wireframes[0].flowNodeId], flowVersionId: project.selectedFlowVersionId, wireframeVersionId: project.selectedWireframeVersionId, wireframeGenerationMode: 'append' } });
  expect(wrong.status()).toBe(400);
  const run = await awaitRun(request, await wireRun(request, project, 'append', '[QA_MISSING_SCREENS] 빈 선택은 누락 페이지 전체'));
  expect(run.entityIds).toEqual([pageId]);
  expect(await getProject(request, project.id)).toEqual(project);
  const response = await request.post(`${API}/proposals/${run.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const result = await getProject(request, project.id);
  expect(allWireVersions(result)).toHaveLength(2);
  for (const screen of project.wireframes) expect(result.wireframes.find(candidate => candidate.id === screen.id)).toEqual(screen);
  expect(result.wireframes.find(screen => screen.flowNodeId === pageId)?.name).toBe('신규 예약 현황');
  expect(activeFlow(result).wireframeVersions.find(version => version.id === project.selectedWireframeVersionId)).toEqual(activeWire(project));
});

test('WV04: source wireframe context mismatch stays pending; source flow revision changes conflict without a new version', async ({ request }) => {
  const original = await seedNestedProject(request);
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', '원본에 기반한 개선', [original.wireframes[0].id]));
  let project = await addWireVersion(request, original);
  const approve = () => request.post(`${API}/proposals/${run.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } });
  const mismatch = await approve();
  expect(mismatch.status()).toBe(409);
  expect(await mismatch.text()).toContain('WIREFRAME_CONTEXT');
  expect((await runProposal(request, run)).status).toBe('pending');
  expect(await getProject(request, project.id)).toEqual(project);
  project = await selectWireVersion(request, project, original.selectedWireframeVersionId!);
  expect((await approve()).ok()).toBeTruthy();
  project = await getProject(request, project.id);
  const secondRun = await awaitRun(request, await wireRun(request, project, 'regenerate', '동시 플로우 변경 검사', [project.wireframes[0].id]));
  const manual = await saveArtifact(request, project, 'flow', { ...project.flow, nodes: project.flow.nodes.map((node, index) => index === 1 ? { ...node, label: '수동으로 바뀐 페이지 문맥' } : node) });
  const conflict = await request.post(`${API}/proposals/${secondRun.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } });
  expect(conflict.status()).toBe(409);
  expect(await conflict.text()).toContain('REVISION_CONFLICT');
  expect((await runProposal(request, secondRun)).status).toBe('conflicted');
  expect(await getProject(request, project.id)).toEqual(manual);
});

test('WV05: reject, failure and delayed cancellation preserve all screen version history', async ({ request }) => {
  const project = await seedNestedProject(request);
  const rejected = await awaitRun(request, await wireRun(request, project, 'regenerate', '거절할 화면 수정본', [project.wireframes[0].id]));
  expect((await request.post(`${API}/proposals/${rejected.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'reject', commandId: randomUUID() } })).ok()).toBeTruthy();
  for (const marker of ['[QA_INVALID]', '[QA_FAILURE]']) {
    const failed = await awaitRun(request, await wireRun(request, project, 'regenerate', marker, [project.wireframes[0].id]), 'failed');
    expect(failed.proposalId).toBeNull();
  }
  const delayed = await wireRun(request, project, 'regenerate', '[QA_DELAY] 늦은 결과 취소', [project.wireframes[0].id]);
  const switched = await addWireVersion(request, project);
  expect((await request.post(`${API}/ai/runs/${delayed.id}/cancel`, { headers: mutationHeaders, data: {} })).ok()).toBeTruthy();
  await new Promise(resolve => setTimeout(resolve, 1900));
  expect((await awaitRun(request, delayed, 'cancelled')).proposalId).toBeNull();
  expect(await getProject(request, project.id)).toEqual(switched);
});
