import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Project, Proposal } from '../../shared/schema.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { getProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, addWireVersion, awaitRun, runProposal, selectWireVersion, wirePath, wireRun } from '../phase4-fixtures.js';
import { linkedHeaders, preparePages, readRun, retryPages, seedThreePageProject, taskFor } from '../phase5-fixtures.js';

test('PJ01: partial approval requires explicit consent and preserves failed and unselected source screens in one new version', async ({ request }) => {
  const original = await seedThreePageProject(request);
  const failedPage = original.wireframes[1].flowNodeId!;
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', `[QA_FAIL_ALWAYS:${failedPage}] 선택한 두 화면 개선`, original.wireframes.slice(0, 2).map(screen => screen.id)));
  expect(run.pageSummary).toEqual({ total: 2, succeeded: 1, failed: 1, cancelled: 0 });
  expect(taskFor(run, original.wireframes[0].flowNodeId).status).toBe('succeeded');
  expect(taskFor(run, failedPage).status).toBe('failed');
  const proposal = await runProposal(request, run);
  expect(proposal.partial).toBe(true); expect(proposal.pageSummary).toEqual(run.pageSummary);
  expect(await getProject(request, original.id)).toEqual(original);
  const unsafe = await request.post(`${API}/proposals/${proposal.id}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } });
  expect([400, 409]).toContain(unsafe.status());
  expect(await getProject(request, original.id)).toEqual(original);
  expect((await runProposal(request, run)).status).toBe('pending');
  const commandId = randomUUID();
  const approve = () => request.post(`${API}/proposals/${proposal.id}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId, allowPartial: true } });
  const approved = await approve();
  expect(approved.ok(), await approved.text()).toBeTruthy();
  const result = await approved.json() as { project: Project; proposal: Proposal };
  expect(result.project.selectedWireframeVersionId).not.toBe(original.selectedWireframeVersionId);
  expect(activeFlow(result.project).wireframeVersions).toHaveLength(2);
  expect(activeFlow(result.project).wireframeVersions[0]).toEqual(activeWire(original));
  expect(result.project.wireframes[1]).toEqual(original.wireframes[1]);
  expect(result.project.wireframes[2]).toEqual(original.wireframes[2]);
  expect(result.project.wireframes[0].elements[0].text).toBe('AI가 수정한 화면 제목');
  expect((await approve()).ok()).toBeTruthy();
  expect(await getProject(request, original.id)).toEqual(result.project);
  const lateRetry = await request.post(`${API}/ai/runs/${run.id}/retry-pages`, { headers: mutationHeaders, data: { commandId: randomUUID() } });
  expect(lateRetry.status()).toBe(409); expect(await lateRetry.text()).toContain('RUN_ALREADY_APPLIED');
});

test('PJ02: failed-only retry reuses persisted successes, invalidates the old proposal and is command-idempotent', async ({ request }) => {
  const original = await seedThreePageProject(request);
  const failedPage = original.wireframes[1].flowNodeId!;
  const first = await awaitRun(request, await wireRun(request, original, 'regenerate', `[QA_FAIL_ONCE:${failedPage}] 두 화면 생성`, original.wireframes.slice(0, 2).map(screen => screen.id)));
  expect(first.pageSummary?.failed).toBe(1);
  const successful = taskFor(first, original.wireframes[0].flowNodeId);
  const failed = taskFor(first, failedPage);
  const commandId = randomUUID();
  const retried = await awaitRun(request, await retryPages(request, first, [failed.id], commandId));
  expect(retried.id).toBe(first.id);
  expect(retried.pageSummary).toEqual({ total: 2, succeeded: 2, failed: 0, cancelled: 0 });
  expect(taskFor(retried, original.wireframes[0].flowNodeId)).toEqual(successful);
  expect(taskFor(retried, failedPage).attempt).toBe(2);
  expect(retried.proposalId).not.toBe(first.proposalId);
  expect((await runProposal(request, first)).status).toBe('cancelled');
  expect((await runProposal(request, retried)).partial).toBe(false);
  const staleApproval = await request.post(`${API}/proposals/${first.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', allowPartial: true, commandId: randomUUID() } });
  expect(staleApproval.status()).toBe(409);
  expect(await retryPages(request, first, [failed.id], commandId)).toEqual(retried);
  expect(await readRun(request, first.id)).toEqual(retried);
  expect(await getProject(request, original.id)).toEqual(original);
});

test('PJ03: retry guards context, source revision and archive state before altering successful tasks or pending proposal', async ({ request }) => {
  const original = await seedThreePageProject(request);
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', `[QA_FAIL_ALWAYS:${original.wireframes[1].flowNodeId}] 문맥 보호`, original.wireframes.slice(0, 2).map(screen => screen.id)));
  const proposal = await runProposal(request, run);
  let project = await addWireVersion(request, original);
  const retry = () => request.post(`${API}/ai/runs/${run.id}/retry-pages`, { headers: mutationHeaders, data: { commandId: randomUUID() } });
  expect((await retry()).status()).toBe(409);
  expect(await readRun(request, run.id)).toEqual(run); expect(await runProposal(request, run)).toEqual(proposal);
  project = await selectWireVersion(request, project, original.selectedWireframeVersionId!);
  project = await saveArtifact(request, project, 'wireframes', project.wireframes.map((screen, index) => index === 0 ? { ...screen, name: '독립 수동 편집' } : screen));
  const revisionConflict = await retry(); expect(revisionConflict.status()).toBe(409); expect(await revisionConflict.text()).toContain('REVISION_CONFLICT');
  expect(await readRun(request, run.id)).toEqual(run); expect(await runProposal(request, run)).toEqual(proposal);
  const archive = await request.post(`${wirePath(project)}/${original.selectedWireframeVersionId}/archive`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(archive.ok()).toBeTruthy();
  const archived = await archive.json();
  const archivedRetry = await retry(); expect(archivedRetry.status()).toBe(409); expect(await archivedRetry.text()).toContain('VERSION_ARCHIVED');
  expect(await readRun(request, run.id)).toEqual(run); expect(await runProposal(request, run)).toEqual(proposal);
  expect(await getProject(request, project.id)).toEqual(archived);
});

test('PJ04: cancellation preserves completed pages and explicit prepare creates a partial proposal without accepting late output', async ({ request }) => {
  const original = await seedThreePageProject(request);
  const slowPage = original.wireframes[1].flowNodeId!;
  const run = await wireRun(request, original, 'regenerate', `[QA_PAGE_DELAY:${slowPage}] 중간 취소`, original.wireframes.slice(0, 2).map(screen => screen.id));
  await expect.poll(async () => (await readRun(request, run.id)).pageTasks?.map(task => task.status)).toEqual(['succeeded', 'running']);
  const cancel = await request.post(`${API}/ai/runs/${run.id}/cancel`, { headers: mutationHeaders, data: {} }); expect(cancel.ok()).toBeTruthy();
  const cancelled = await cancel.json();
  expect(cancelled.proposalId).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 2600));
  const retained = await readRun(request, run.id);
  expect(retained.status).toBe('cancelled');
  expect(retained.pageSummary).toEqual({ total: 2, succeeded: 1, failed: 0, cancelled: 1 });
  expect(taskFor(retained, slowPage).screens).toBeNull();
  const commandId = randomUUID();
  const prepared = await preparePages(request, retained, commandId);
  expect(prepared.pageTasks).toEqual(retained.pageTasks);
  expect((await runProposal(request, prepared)).partial).toBe(true);
  expect(await preparePages(request, retained, commandId)).toEqual(prepared);
  expect(await getProject(request, original.id)).toEqual(original);
});

test('PJ05: retry rejects successful targets and enforces three attempts without losing successful output', async ({ request }) => {
  const original = await seedThreePageProject(request);
  let run = await awaitRun(request, await wireRun(request, original, 'regenerate', `[QA_FAIL_ALWAYS:${original.wireframes[1].flowNodeId}] 실패 한도`, original.wireframes.slice(0, 2).map(screen => screen.id)));
  const successful = run.pageTasks![0];
  const invalid = await request.post(`${API}/ai/runs/${run.id}/retry-pages`, { headers: mutationHeaders, data: { commandId: randomUUID(), pageTaskIds: [successful.id] } });
  expect([400, 409]).toContain(invalid.status()); expect(await readRun(request, run.id)).toEqual(run);
  for (let attempt = 2; attempt <= 3; attempt++) { run = await awaitRun(request, await retryPages(request, run)); expect(run.pageTasks![1].attempt).toBe(attempt); expect(run.pageTasks![0]).toEqual(successful); }
  const limit = await request.post(`${API}/ai/runs/${run.id}/retry-pages`, { headers: mutationHeaders, data: { commandId: randomUUID() } });
  expect([400, 409]).toContain(limit.status()); expect(await readRun(request, run.id)).toEqual(run);
  expect(await getProject(request, original.id)).toEqual(original);
});

test('PJ06: malformed and wrong-page provider responses fail only their page while valid results remain reviewable', async ({ request }) => {
  const original = await seedThreePageProject(request);
  const prompt = `[QA_INVALID_PAGE:${original.wireframes[1].flowNodeId}] [QA_WRONG_PAGE:${original.wireframes[2].flowNodeId}] 검증 실패 분리`;
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', prompt));
  expect(run.pageSummary).toEqual({ total: 3, succeeded: 1, failed: 2, cancelled: 0 });
  expect(run.pageTasks?.map(task => task.screens?.length || 0)).toEqual([1, 0, 0]);
  expect((await runProposal(request, run)).partial).toBe(true);
  expect(await getProject(request, original.id)).toEqual(original);
});

test('PJ07: partial source regeneration detaches only a failed linked follower, preserving its rendered content and source history', async ({ request }) => {
  let original = await seedThreePageProject(request);
  original = await saveArtifact(request, original, 'wireframes', linkedHeaders(original, [1, 2]));
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', `[QA_FAIL_ALWAYS:${original.wireframes[1].flowNodeId}] 공유 헤더 개선`, original.wireframes.slice(0, 2).map(screen => screen.id)));
  const proposal = await runProposal(request, run);
  expect(proposal.navigationDetachedScreenIds).toEqual([original.wireframes[1].id]);
  expect(proposal.partial).toBe(true);
  const response = await request.post(`${API}/proposals/${proposal.id}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID(), allowPartial: true } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { project } = await response.json() as { project: Project };
  expect(activeFlow(project).wireframeVersions[0]).toEqual(activeWire(original));
  expect(project.wireframes[1].elements).toEqual(original.wireframes[1].elements);
  expect(project.wireframes[1].navigationSync).toBeUndefined();
  expect(project.wireframes[2].navigationSync).toEqual(original.wireframes[2].navigationSync);
  expect(project.wireframes[2].elements[0].text).toBe('AI가 수정한 화면 제목');
  expect(project.wireframes[2].elements.slice(1)).toEqual(original.wireframes[2].elements.slice(1));
});
