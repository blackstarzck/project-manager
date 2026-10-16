import { expect, test } from '@playwright/test';
import type { AiRun } from '../../shared/schema.js';
import { API, mutationHeaders } from '../fixtures.js';
import { addFlowVersion, getProject, seedNestedProject, selectFlowVersion } from '../phase2-fixtures.js';

test('V05/V06: a delayed version-selection response cannot replace a newer independent AI approval', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const copied = await addFlowVersion(request, original, { copy: true });
  const project = await selectFlowVersion(request, copied, original.selectedFlowVersionId!);
  const response = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { artifact: 'prd', prompt: 'PRD 개요 개선' } });
  expect(response.status()).toBe(202);
  let run: AiRun = await response.json();
  await expect.poll(async () => { run = await (await request.get(`${API}/ai/runs/${run.id}`)).json(); return run.status; }).toBe('succeeded');
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '유저플로우', exact: true }).click();
  await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  // On this viewport the nonmodal AI overlay covers the version list.
  await page.getByRole('button', { name: 'AI 패널 닫기', exact: true }).click();
  let markCommitted!: () => void;
  let releaseSelection!: () => void;
  const committed = new Promise<void>(resolve => { markCommitted = resolve; });
  const released = new Promise<void>(resolve => { releaseSelection = resolve; });
  const selected = project.flowGroups[0].versions.find(version => version.id === copied.selectedFlowVersionId)!;
  await page.route(`**/api/projects/${project.id}/flow-versions/${selected.id}/select`, async route => {
    const savedResponse = await route.fetch();
    markCommitted();
    await released;
    await route.fulfill({ response: savedResponse });
  });
  try {
    await page.getByRole('button', { name: `${project.flowGroups[0].name} / ${selected.name} 선택`, exact: true }).click();
    await committed;
    // The AI panel is intentionally still usable while the editor waits for a version response.
    await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
    await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
    await page.getByRole('button', { name: '선택 승인', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const approved = await getProject(request, project.id);
    expect(approved.prd[0].content).toContain('AI가 제안한');
    expect(approved.selectedFlowVersionId).toBe(selected.id);
    releaseSelection();
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('tab', { name: 'PRD', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toContainText('AI가 제안한 예약 서비스 개요입니다.');
    expect((await getProject(request, project.id)).prd).toEqual(approved.prd);
  } finally {
    releaseSelection();
  }
});
