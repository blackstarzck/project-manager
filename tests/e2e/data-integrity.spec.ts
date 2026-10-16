import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { AiRun, Artifact, Project } from '../../shared/schema.js';
import { API, createProject, mutationHeaders, saveArtifact, seedProject } from '../fixtures.js';

async function getProject(request: APIRequestContext, projectId: string): Promise<Project> {
  const response = await request.get(`${API}/projects/${projectId}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function generate(request: APIRequestContext, project: Project, prompt = '도서관 기획 내용을 개선해 주세요.', artifact: Artifact = 'prd', entityIds?: string[]): Promise<AiRun> {
  const response = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { artifact, prompt, entityIds } });
  expect(response.status(), await response.text()).toBe(202);
  return response.json();
}

async function waitRun(request: APIRequestContext, run: AiRun, status: AiRun['status']): Promise<AiRun> {
  let result = run;
  await expect.poll(async () => {
    result = await (await request.get(`${API}/ai/runs/${run.id}`)).json();
    return result.status;
  }).toBe(status);
  return result;
}

async function resolve(request: APIRequestContext, proposalId: string, action: 'approve' | 'reject', commandId = randomUUID()) {
  return request.post(`${API}/proposals/${proposalId}/resolve`, { headers: mutationHeaders, data: { action, commandId } });
}

test('Q04/Q05: AI drafts wait for approval; duplicated command applies once; rejection preserves document', async ({ request }) => {
  const project = await seedProject(request);
  const run = await waitRun(request, await generate(request, project), 'succeeded');
  expect((await getProject(request, project.id)).prd).toEqual(project.prd);
  expect(run.proposalId).toBeTruthy();
  const commandId = randomUUID();
  const approved = await resolve(request, run.proposalId!, 'approve', commandId);
  expect(approved.ok(), await approved.text()).toBeTruthy();
  const applied = await getProject(request, project.id);
  expect(applied.prd[0].content).toContain('AI가 제안한');
  const repeated = await resolve(request, run.proposalId!, 'approve', commandId);
  expect(repeated.ok(), await repeated.text()).toBeTruthy();
  expect((await getProject(request, project.id)).revision).toBe(applied.revision);

  // The fixture modifies the first item. Restore differing manual text before rejecting another proposal.
  const manual = await saveArtifact(request, applied, 'prd', applied.prd.map((item, index) => index ? item : { ...item, content: '<p>거절할 때 보존할 수동 편집</p>' }));
  const rejectRun = await waitRun(request, await generate(request, manual), 'succeeded');
  const rejected = await resolve(request, rejectRun.proposalId!, 'reject');
  expect(rejected.ok(), await rejected.text()).toBeTruthy();
  const afterReject = await getProject(request, project.id);
  expect(afterReject.prd).toEqual(manual.prd);
  expect(afterReject.revision).toBe(manual.revision);
});

test('Q06: older AI proposal and stale manual save never overwrite a newer edit', async ({ request }) => {
  const project = await seedProject(request);
  const run = await waitRun(request, await generate(request, project), 'succeeded');
  const manual = await saveArtifact(request, project, 'prd', project.prd.map((item, index) => index ? item : { ...item, content: '<p>생성 이후 사용자가 수정한 중요 내용</p>' }));
  const rejected = await resolve(request, run.proposalId!, 'approve');
  expect(rejected.status()).toBe(409);
  const staleSave = await request.put(`${API}/projects/${project.id}/artifacts/prd`, { headers: mutationHeaders, data: { expectedRevision: project.artifactRevisions.prd, value: project.prd } });
  expect(staleSave.status()).toBe(409);
  expect((await getProject(request, project.id)).prd).toEqual(manual.prd);
});

test('Q07: invalid AI output and late response after cancellation preserve all project data', async ({ request }) => {
  const project = await seedProject(request);
  await waitRun(request, await generate(request, project, '[QA_INVALID]'), 'failed');
  const run = await generate(request, project, '[QA_DELAY] 취소 검사');
  const cancelled = await request.post(`${API}/ai/runs/${run.id}/cancel`, { headers: mutationHeaders, data: {} });
  expect(cancelled.ok()).toBeTruthy();
  await waitRun(request, run, 'cancelled');
  await new Promise(resolve => setTimeout(resolve, 1900));
  const finalRun = await (await request.get(`${API}/ai/runs/${run.id}`)).json();
  expect(finalRun.status).toBe('cancelled');
  expect(finalRun.proposalId).toBeNull();
  expect(await getProject(request, project.id)).toEqual(project);
});

test('Q08/Q12/Q13: regeneration is scoped and flow edits preserve existing screens', async ({ request }) => {
  const project = await seedProject(request);
  const another = await seedProject(request);
  const manualScreens = await saveArtifact(request, project, 'wireframes', project.wireframes.map((screen, index) => index === 1 ? { ...screen, elements: screen.elements.map((element, i) => i === 0 ? { ...element, text: '절대로 잃으면 안 되는 수동 제목' } : element) } : screen));
  const manual = await saveArtifact(request, manualScreens, 'flow', { ...manualScreens.flow, nodes: manualScreens.flow.nodes.map((node, i) => i === 1 ? { ...node, label: '검색 조건이 바뀐 화면' } : node) });
  const run = await waitRun(request, await generate(request, manual, '선택 화면만 개선', 'wireframes', [manual.wireframes[0].id]), 'succeeded');
  const response = await resolve(request, run.proposalId!, 'approve');
  expect(response.ok(), await response.text()).toBeTruthy();
  const regenerated = await getProject(request, project.id);
  expect(regenerated.wireframes[0].elements[0].text).toBe('AI가 수정한 화면 제목');
  expect(regenerated.wireframes[1]).toEqual(manual.wireframes[1]);
  expect(await getProject(request, another.id)).toEqual(another);
  const changed = await saveArtifact(request, regenerated, 'flow', { ...regenerated.flow, nodes: regenerated.flow.nodes.map((node, i) => i === 1 ? { ...node, label: '갱신한 도서 검색' } : node) });
  expect(changed.wireframes).toEqual(regenerated.wireframes);
  expect(changed.artifactRevisions.flow).toBeGreaterThan(changed.wireframes[0].flowRevision);
});

test('Q14/Q16: history restore remains monotonic and backup restores as isolated IDs', async ({ request }) => {
  const project = await seedProject(request);
  const revisions = await (await request.get(`${API}/projects/${project.id}/revisions`)).json();
  const baseline = revisions.find((entry: { revision: number }) => entry.revision === project.revision);
  expect(baseline).toBeTruthy();
  const edited = await saveArtifact(request, project, 'prd', project.prd.map(item => ({ ...item, content: '<p>복원 전 수정</p>' })));
  const restore = await request.post(`${API}/projects/${project.id}/revisions/${baseline.id}/restore`, { headers: mutationHeaders, data: { expectedRevision: edited.revision } });
  expect(restore.ok(), await restore.text()).toBeTruthy();
  const restored: Project = await restore.json();
  expect(restored.prd[0].content).toBe(project.prd[0].content);
  expect(restored.revision).toBeGreaterThan(edited.revision);
  expect(restored.prd[0].revision).toBeGreaterThan(edited.prd[0].revision);
  const backup = await request.get(`${API}/projects/${project.id}/backup`);
  const file = await backup.json();
  expect(JSON.stringify(file)).not.toMatch(/GROQ_API_KEY|gsk_[A-Za-z0-9]{15,}/);
  const imported = await request.post(`${API}/backups/restore`, { headers: mutationHeaders, data: file });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const copy: Project = await imported.json();
  expect(copy.id).not.toBe(project.id);
  expect(copy.prd[0].id).not.toBe(project.prd[0].id);
  expect(copy.features[0].prdIds).toContain(copy.prd[0].id);
  expect(copy.flow.nodes[1].featureIds).toContain(copy.features[1].id);
  expect(copy.wireframes[0].elements[2].targetScreenId).toBe(copy.wireframes[1].id);
});

test('Q09/Q18: dangling references and missing mutation guard are rejected', async ({ request }) => {
  const project = await seedProject(request);
  const bad = await request.put(`${API}/projects/${project.id}/artifacts/flow`, { headers: mutationHeaders, data: { expectedRevision: project.artifactRevisions.flow, value: { ...project.flow, edges: [{ id: 'invalid-edge', source: 'missing', target: project.flow.nodes[0].id, label: '' }] } } });
  expect(bad.status()).toBeGreaterThanOrEqual(400);
  expect(bad.status()).toBeLessThan(500);
  expect((await getProject(request, project.id)).flow).toEqual(project.flow);
  const unguarded = await request.post(`${API}/projects`, { data: { name: '보호되지 않은 요청' } });
  expect(unguarded.status()).toBeGreaterThanOrEqual(400);
  const status = await (await request.get(`${API}/ai/status`)).json();
  expect(status.configured).toBe(true);
  expect(JSON.stringify(status)).not.toMatch(/apiKey|gsk_[A-Za-z0-9]{15,}/);
});

test('Q01: project edits, archive/restore, and duplicate preserve independent content', async ({ request }) => {
  const project = await createProject(request);
  const edit = await request.patch(`${API}/projects/${project.id}`, { headers: mutationHeaders, data: { name: '수정된 도서관', expectedRevision: project.revision } });
  expect(edit.ok()).toBeTruthy();
  const updated: Project = await edit.json();
  const archive = await request.patch(`${API}/projects/${project.id}`, { headers: mutationHeaders, data: { archived: true, expectedRevision: updated.revision } });
  expect(archive.ok()).toBeTruthy();
  expect((await (await request.get(`${API}/projects`)).json()).some((row: Project) => row.id === project.id)).toBe(false);
  const archived: Project = await archive.json();
  const restore = await request.patch(`${API}/projects/${project.id}`, { headers: mutationHeaders, data: { archived: false, expectedRevision: archived.revision } });
  expect(restore.ok()).toBeTruthy();
  const duplicate = await request.post(`${API}/projects/${project.id}/duplicate`, { headers: mutationHeaders, data: {} });
  expect(duplicate.ok()).toBeTruthy();
  expect((await duplicate.json()).id).not.toBe(project.id);
});
