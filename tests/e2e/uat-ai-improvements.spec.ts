import { expect, test, type Page } from '@playwright/test';
import { API, seedProject } from '../fixtures.js';

const assistant = (page: Page) => page.getByRole('complementary', { name: 'AI 기획 도우미', exact: true });
const reviewDialog = (page: Page) => page.getByRole('dialog', { name: 'AI 변경 제안 검토', exact: true });
const composer = (page: Page) => page.getByRole('textbox', { name: 'AI 요청', exact: true });

test('UAI01: PRD assistant prepares an editable draft without generation and preserves an existing request', async ({ page, request }) => {
  const project = await seedProject(request);
  const started: unknown[] = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(`/api/projects/${project.id}/ai/runs`)) started.push(req.postDataJSON()); });
  await page.goto(`/#project/${project.id}/prd`);
  await page.getByRole('button', { name: 'AI 작성 도우미', exact: true }).click();
  await expect(assistant(page)).toBeVisible();
  await expect(composer(page)).toHaveValue(/현재 PRD/);
  await expect(composer(page)).toBeFocused();
  expect(started).toHaveLength(0);
  expect((await (await request.get(`${API}/projects/${project.id}/activity`)).json()).runs).toHaveLength(0);

  await composer(page).fill('내가 직접 작성한 요청');
  await composer(page).press('Enter');
  await page.keyboard.insertText('새 문장');
  // Enter edits the request; only the visible submit action sends it.
  await expect(composer(page)).toHaveValue('내가 직접 작성한 요청\n새 문장');
  expect(started).toHaveLength(0);
  await page.getByRole('button', { name: 'AI 패널 닫기', exact: true }).click();
  await page.getByRole('button', { name: 'AI 작성 도우미', exact: true }).click();
  await expect(composer(page)).toHaveValue('내가 직접 작성한 요청\n새 문장');
  expect(started).toHaveLength(0);
  await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ artifact: 'prd', prompt: '내가 직접 작성한 요청\n새 문장' });
  expect(await (await request.get(`${API}/projects/${project.id}`)).json()).toEqual(project);
});

test('UAI02: reopening PRD assistant during a pending acknowledgement preserves the next draft and starts no extra run', async ({ page, request }) => {
  const project = await seedProject(request);
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/projects/*/ai/runs', async route => {
    calls++;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto(`/#project/${project.id}/prd`);
  await page.getByRole('button', { name: 'AI 작성 도우미', exact: true }).click();
  await composer(page).fill('첫 번째 요청');
  await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await composer(page).fill('응답을 기다리며 작성한 다음 초안');
  await page.getByRole('button', { name: 'AI 패널 닫기', exact: true }).click();
  await page.getByRole('button', { name: 'AI 작성 도우미', exact: true }).click();
  await expect(composer(page)).toHaveValue('응답을 기다리며 작성한 다음 초안');
  await expect(page.getByRole('button', { name: 'AI 생성 요청', exact: true })).toBeDisabled();
  expect(calls).toBe(1);
  release();
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue('응답을 기다리며 작성한 다음 초안');
  expect(calls).toBe(1);
});

for (const action of ['approve', 'reject'] as const) {
  test(`UAI03-${action}: a partial resolution clears selection, survives reopening/reloading, and needs explicit reselection`, async ({ page, request }) => {
    const project = await seedProject(request);
    let resolutions = 0;
    page.on('request', req => { if (req.method() === 'POST' && /\/api\/proposals\/[^/]+\/resolve$/.test(req.url())) resolutions++; });
    await page.goto(`/#project/${project.id}/wireframes`);
    await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
    await composer(page).fill('두 화면의 제목을 명확하게 다듬어 줘');
    await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
    await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
    const dialog = reviewDialog(page);
    await expect(dialog.locator('.proposal-change')).toHaveCount(2);
    await expect(dialog.locator('#review-selection-count')).toHaveText('2개 변경 선택');
    expect(await (await request.get(`${API}/projects/${project.id}`)).json()).toEqual(project);
    await dialog.getByRole('checkbox', { name: '전체 선택', exact: true }).uncheck();
    await dialog.locator('.proposal-change input[type=checkbox]').first().check();
    await dialog.getByRole('button', { name: action === 'approve' ? '선택 승인' : '선택 거절', exact: true }).click();
    await expect(dialog.locator('.proposal-change')).toHaveCount(1);
    await expect(dialog.locator('.ai-review-feedback')).toContainText(action === 'approve' ? '1개 변경을 승인해 문서에 반영했어요. 남은 1개는 검토 대기 중입니다.' : '1개 변경을 거절했어요. 남은 1개는 검토 대기 중입니다.');
    await expect(dialog.locator('#review-selection-count')).toHaveText('0개 변경 선택');
    await expect(dialog.getByRole('button', { name: '선택 승인', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '선택 거절', exact: true })).toBeDisabled();
    expect(resolutions).toBe(1);
    const afterPartial = await (await request.get(`${API}/projects/${project.id}`)).json();
    expect(afterPartial.wireframes[0].elements[0].text).toBe(action === 'approve' ? 'AI가 수정한 화면 제목' : project.wireframes[0].elements[0].text);
    expect(afterPartial.wireframes[1]).toEqual(project.wireframes[1]);

    await dialog.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
    await expect(dialog.locator('#review-selection-count')).toHaveText('0개 변경 선택');
    await expect(dialog.getByRole('button', { name: '선택 승인', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
    await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
    await expect(dialog.locator('#review-selection-count')).toHaveText('0개 변경 선택');
    await expect(dialog.locator('.proposal-change input[type=checkbox]')).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: '선택 승인', exact: true })).toBeDisabled();
    expect(resolutions).toBe(1);
    await dialog.locator('.proposal-change input[type=checkbox]').check();
    await expect(dialog.getByRole('button', { name: '선택 승인', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: '선택 승인', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.ai-resolution-feedback')).toContainText('1개 변경을 승인해 문서에 반영했어요. 모든 변경을 검토했어요.');
    const final = await (await request.get(`${API}/projects/${project.id}`)).json();
    expect(final.wireframes[0]).toEqual(afterPartial.wireframes[0]);
    expect(final.wireframes[1].elements[0].text).toBe('AI가 수정한 화면 제목');
    expect(resolutions).toBe(2);
  });
}
