import { expect, test, type Page } from '@playwright/test';
import type { AiRun, Project } from '../../shared/schema.js';
import { API, saveArtifact } from '../fixtures.js';
import { getProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, awaitRun, wireRun } from '../phase4-fixtures.js';
import { linkedHeaders, readRun, seedThreePageProject } from '../phase5-fixtures.js';

async function openAi(page: Page, project: Project) {
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
}

test('PU01: failed-only retry UI sends only failed task IDs and keeps validated success visible through reload', async ({ page, request }) => {
  const original = await seedThreePageProject(request);
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', `[QA_FAIL_ONCE:${original.wireframes[1].flowNodeId}] 두 화면 개선`, original.wireframes.slice(0, 2).map(screen => screen.id)));
  await openAi(page, original);
  const tasks = page.getByRole('region', { name: '화면별 생성 상태', exact: true });
  await expect(tasks).toContainText('전체 2개'); await expect(tasks).toContainText('성공 1개'); await expect(tasks).toContainText('실패 1개');
  await page.getByRole('button', { name: '실패한 화면만 다시 시도', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/artifacts/phase5-page-failure-retry.png', fullPage: true });
  const success = page.getByTestId(`page-task-${run.pageTasks![0].id}`);
  await success.locator('summary').click();
  await expect(success.locator('pre')).toContainText('AI가 수정한 화면 제목');
  const started = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith(`/ai/runs/${run.id}/retry-pages`));
  await page.getByRole('button', { name: '실패한 화면만 다시 시도', exact: true }).click();
  expect((await started).postDataJSON().pageTaskIds).toEqual([run.pageTasks![1].id]);
  await expect(success.locator('pre')).toBeVisible();
  await expect(page.getByTestId(`page-task-${run.pageTasks![1].id}`)).toHaveAttribute('data-status', 'succeeded');
  const finished = await readRun(request, run.id);
  expect(finished.pageTasks![0]).toEqual(run.pageTasks![0]);
  expect(finished.pageTasks![1].attempt).toBe(2);
  expect(await getProject(request, original.id)).toEqual(original);
  await page.reload();
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
  await expect(tasks).toContainText('성공 2개');
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  await page.getByRole('button', { name: '선택 승인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await getProject(request, original.id);
  expect(activeFlow(saved).wireframeVersions).toHaveLength(2);
  expect(activeFlow(saved).wireframeVersions[0]).toEqual(activeWire(original));
  await expect(page.getByRole('button', { name: '실패한 화면만 다시 시도', exact: true })).toHaveCount(0);
});

test('PU02: partial review explains detached followers and explicitly approves only successful pages', async ({ page, request }) => {
  let original = await seedThreePageProject(request);
  original = await saveArtifact(request, original, 'wireframes', linkedHeaders(original, [1, 2]));
  const run = await awaitRun(request, await wireRun(request, original, 'regenerate', `[QA_FAIL_ALWAYS:${original.wireframes[1].flowNodeId}] 공통 헤더 개선`, original.wireframes.slice(0, 2).map(screen => screen.id)));
  await openAi(page, original);
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 변경 제안 검토', exact: true });
  await expect(dialog.getByRole('note', { name: '일부 화면 생성 결과', exact: true })).toContainText('보존되는 화면 1개의 공통 내비게이션 연결은 새 결과에서 해제됩니다');
  await expect(dialog.getByRole('button', { name: '선택 승인', exact: true })).toHaveCount(0);
  expect(await getProject(request, original.id)).toEqual(original);
  await page.screenshot({ path: 'tests/artifacts/phase5-partial-approval.png', fullPage: true });
  const approval = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith(`/proposals/${run.proposalId}/resolve`));
  await dialog.getByRole('button', { name: '성공한 화면만 승인', exact: true }).click();
  expect((await approval).postDataJSON()).toMatchObject({ action: 'approve', allowPartial: true });
  await expect(dialog).toHaveCount(0);
  const saved = await getProject(request, original.id);
  expect(saved.wireframes[1].elements).toEqual(original.wireframes[1].elements);
  expect(saved.wireframes[1].navigationSync).toBeUndefined();
  expect(activeFlow(saved).wireframeVersions[0]).toEqual(activeWire(original));
});

test('PU03: cancel UI retains validated successes and prepares review without a second generation request', async ({ page, request }) => {
  const original = await seedThreePageProject(request);
  await openAi(page, original);
  await page.getByRole('button', { name: 'AI 패널 닫기', exact: true }).click();
  await page.getByRole('button', { name: '전체 화면 개선', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '와이어프레임 생성 대상 선택', exact: true });
  await dialog.getByTestId(`wireframe-target-${original.wireframes[2].id}`).uncheck();
  await dialog.getByRole('textbox', { name: '화면 생성 추가 요청', exact: true }).fill(`[QA_PAGE_DELAY:${original.wireframes[1].flowNodeId}] 중간 취소 검수`);
  const started = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith(`/projects/${original.id}/ai/runs`));
  await dialog.getByRole('button', { name: '선택한 화면 생성 요청', exact: true }).click();
  const run = await (await started).json() as AiRun;
  await expect(page.getByTestId(`page-task-${run.pageTasks![0].id}`)).toHaveAttribute('data-status', 'succeeded');
  await page.getByRole('button', { name: '생성 취소', exact: true }).click();
  await expect(page.getByRole('button', { name: '보관된 성공 화면 검토', exact: true })).toBeVisible();
  expect((await readRun(request, run.id)).proposalId).toBeNull();
  const newCalls: string[] = [];
  page.on('request', req => { if (req.method() === 'POST' && /\/ai\/runs$|\/retry-pages$/.test(new URL(req.url()).pathname)) newCalls.push(req.url()); });
  await page.getByRole('button', { name: '보관된 성공 화면 검토', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI 변경 제안 검토', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '성공한 화면만 승인', exact: true })).toBeVisible();
  expect(newCalls).toEqual([]);
  expect((await readRun(request, run.id)).pageSummary).toEqual({ total: 2, succeeded: 1, failed: 0, cancelled: 1 });
  expect(await getProject(request, original.id)).toEqual(original);
});
