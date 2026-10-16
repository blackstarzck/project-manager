import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { AiRun, FlowGenerationMode, Project, ProjectActivity, Proposal } from '../../shared/schema.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { addFlowVersion, getProject, seedNestedProject, selectFlowVersion } from '../phase2-fixtures.js';

const versions = (project: Project) => project.flowGroups.flatMap(group => group.versions);
async function generate(request: APIRequestContext, project: Project, mode: FlowGenerationMode, prompt: string) {
  const response = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { artifact: 'flow', prompt, flowVersionId: project.selectedFlowVersionId, flowGenerationMode: mode } });
  expect(response.status(), await response.text()).toBe(202);
  return response.json() as Promise<AiRun>;
}
async function waitRun(request: APIRequestContext, run: AiRun, status: AiRun['status'] = 'succeeded') {
  let result = run;
  await expect.poll(async () => { result = await (await request.get(`${API}/ai/runs/${run.id}`)).json(); return result.status; }).toBe(status);
  return result;
}
async function proposalFor(request: APIRequestContext, run: AiRun) {
  const activity: ProjectActivity = await (await request.get(`${API}/projects/${run.projectId}/activity`)).json();
  return activity.proposals.find(proposal => proposal.id === run.proposalId)!;
}
const resolve = (request: APIRequestContext, run: AiRun, action = 'approve', commandId = randomUUID()) => request.post(`${API}/proposals/${run.proposalId}/resolve`, { headers: mutationHeaders, data: { action, commandId } });

test('G01: new-version proposal with replacement page IDs forks only on approval and duplicate approval creates once', async ({ request }) => {
  const original = await seedNestedProject(request);
  const run = await waitRun(request, await generate(request, original, 'new-version', '[QA_NEW_VERSION_CONTEXT] [QA_FRESH_FLOW] 전체 여정을 재설계'));
  expect(run.flowGenerationMode).toBe('new-version');
  expect(await getProject(request, original.id)).toEqual(original);
  expect((await proposalFor(request, run)).status).toBe('pending');
  const commandId = randomUUID();
  const response = await resolve(request, run, 'approve', commandId);
  expect(response.ok(), await response.text()).toBeTruthy();
  const result = await response.json() as { project: Project; proposal: Proposal };
  expect(result.project.flowGroups).toHaveLength(1);
  expect(versions(result.project)).toHaveLength(2);
  expect(versions(result.project).find(version => version.id === original.selectedFlowVersionId)).toEqual(versions(original)[0]);
  expect(result.project.selectedFlowVersionId).not.toBe(original.selectedFlowVersionId);
  expect(result.proposal.resultFlowVersionId).toBe(result.project.selectedFlowVersionId);
  expect(result.project.wireframes).toEqual([]);
  expect(result.project.flow.nodes.every(node => node.id.startsWith('fresh-'))).toBeTruthy();
  expect(result.project.prd).toEqual(original.prd);
  expect(result.project.features).toEqual(original.features);
  expect((await resolve(request, run, 'approve', commandId)).ok()).toBeTruthy();
  expect((await resolve(request, run)).ok()).toBeTruthy();
  expect(await getProject(request, original.id)).toEqual(result.project);
});

test('G02: new-group receives blank visual context, keeps PRD/features, and identical revised graph still requires approval', async ({ request }) => {
  const original = await seedNestedProject(request);
  const same = await waitRun(request, await generate(request, original, 'new-version', '[QA_SAME_FLOW] 동일한 그래프의 다음 버전'));
  const proposal = await proposalFor(request, same);
  expect(proposal.status).toBe('pending');
  expect(proposal.changes).toHaveLength(1);
  expect(await getProject(request, original.id)).toEqual(original);
  const approval = await resolve(request, same);
  expect(approval.ok(), await approval.text()).toBeTruthy();
  const forked = await getProject(request, original.id);
  expect(forked.flow).toEqual(original.flow);
  expect(forked.wireframes).toEqual([]);
  expect(versions(forked)).toHaveLength(2);
  const groupRun = await waitRun(request, await generate(request, forked, 'new-group', '[QA_NEW_GROUP_CONTEXT] [QA_FRESH_FLOW] 새 관리 흐름'));
  expect(await getProject(request, original.id)).toEqual(forked);
  const groupApproval = await resolve(request, groupRun);
  expect(groupApproval.ok(), await groupApproval.text()).toBeTruthy();
  const result = await getProject(request, original.id);
  expect(result.flowGroups).toHaveLength(2);
  expect(result.flowGroups[0]).toEqual(forked.flowGroups[0]);
  expect(result.flowGroups[1].versions).toHaveLength(1);
  expect(result.flowGroups[1].versions[0].number).toBe(1);
  expect(result.wireframes).toEqual([]);
  expect(result.prd).toEqual(original.prd);
  expect(result.features).toEqual(original.features);
});

test('G03: reject, malformed output, provider failure and cancellation never create empty flow versions', async ({ request }) => {
  const original = await seedNestedProject(request);
  const rejectRun = await waitRun(request, await generate(request, original, 'new-group', '[QA_FRESH_FLOW] 거절할 신규 그룹'));
  expect((await resolve(request, rejectRun, 'reject')).ok()).toBeTruthy();
  expect((await proposalFor(request, rejectRun)).status).toBe('rejected');
  for (const marker of ['[QA_INVALID]', '[QA_FAILURE]']) {
    const failed = await waitRun(request, await generate(request, original, 'new-version', `${marker} 실패할 수정 버전`), 'failed');
    expect(failed.proposalId).toBeNull();
  }
  const cancelled = await generate(request, original, 'new-group', '[QA_DELAY] [QA_FRESH_FLOW] 취소할 그룹');
  expect((await request.post(`${API}/ai/runs/${cancelled.id}/cancel`, { headers: mutationHeaders, data: {} })).ok()).toBeTruthy();
  // Fixture deliberately ignores AbortSignal and returns after 1.6s.
  await new Promise(resolve => setTimeout(resolve, 1900));
  expect((await waitRun(request, cancelled, 'cancelled')).proposalId).toBeNull();
  expect(await getProject(request, original.id)).toEqual(original);
});

test('G04: new-version proposal respects origin context and concurrent source revision without overwriting either branch', async ({ request }) => {
  const original = await seedNestedProject(request);
  const run = await waitRun(request, await generate(request, original, 'new-version', '[QA_FRESH_FLOW] 안전한 새 버전'));
  const other = await addFlowVersion(request, original, { copy: true });
  const mismatch = await resolve(request, run);
  expect(mismatch.status()).toBe(409);
  expect(await mismatch.text()).toContain('FLOW_CONTEXT_CONFLICT');
  expect((await proposalFor(request, run)).status).toBe('pending');
  expect(await getProject(request, original.id)).toEqual(other);
  let restored = await selectFlowVersion(request, other, original.selectedFlowVersionId!);
  expect((await resolve(request, run)).ok()).toBeTruthy();
  restored = await getProject(request, original.id);
  expect(versions(restored)).toHaveLength(3);
  expect(versions(restored).find(version => version.id === other.selectedFlowVersionId)).toEqual(versions(other).find(version => version.id === other.selectedFlowVersionId));
  const conflictRun = await waitRun(request, await generate(request, restored, 'new-version', '[QA_FRESH_FLOW] 동시에 수정할 원본'));
  const manual = await saveArtifact(request, restored, 'flow', { ...restored.flow, nodes: restored.flow.nodes.map((node, index) => index === 1 ? { ...node, label: '사용자가 직접 확정한 노드' } : node) });
  const conflict = await resolve(request, conflictRun);
  expect(conflict.status()).toBe(409);
  expect(await conflict.text()).toContain('REVISION_CONFLICT');
  expect((await proposalFor(request, conflictRun)).status).toBe('conflicted');
  expect(await getProject(request, original.id)).toEqual(manual);
});

test('G05: mode validation rejects invalid artifact/selection and omitted mode retains in-place compatibility', async ({ request }) => {
  let project = await seedNestedProject(request);
  for (const data of [
    { artifact: 'prd', flowGenerationMode: 'new-group' },
    { artifact: 'flow', flowGenerationMode: 'new-version', entityIds: [project.flow.nodes[0].id] },
  ]) {
    const response = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { ...data, prompt: '잘못된 모드 요청', flowVersionId: project.selectedFlowVersionId } });
    expect(response.status()).toBe(400);
  }
  project = await saveArtifact(request, project, 'flow', { ...project.flow, nodes: project.flow.nodes.map((node, index) => index === 1 ? { ...node, label: '수정할 이름' } : node) });
  const response = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { artifact: 'flow', prompt: '기존 버전의 이름 편집', flowVersionId: project.selectedFlowVersionId } });
  expect(response.status()).toBe(202);
  const run = await waitRun(request, await response.json());
  expect(run.flowGenerationMode).toBe('edit');
  expect((await resolve(request, run)).ok()).toBeTruthy();
  const result = await getProject(request, project.id);
  expect(versions(result)).toHaveLength(1);
  expect(result.selectedFlowVersionId).toBe(project.selectedFlowVersionId);
  expect(result.wireframes).toEqual(project.wireframes);
  expect(result.flow.nodes[1].label).toBe('도서 검색');
});
