import { expect, test, type Page } from '@playwright/test';
import { API, saveArtifact, seedProject } from '../fixtures.js';

const panel = (page: Page) => page.getByRole('complementary', { name: 'AI 기획 도우미', exact: true });
const preference = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('planit.ai-panel.v1') || 'null'));
async function openPanel(page: Page) {
  if (!await panel(page).isVisible()) await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}

test('UXP01: docking preserves document room and viewport changes retain preferred layout, draft and project revision', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await openPanel(page);
  await expect(panel(page)).toHaveAttribute('data-presentation', 'docked');
  await expect(panel(page)).toHaveCSS('width', '360px');
  await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill('창 크기와 관계없이 보존할 요청 초안');
  const saved = await preference(page);
  await page.setViewportSize({ width: 970, height: 760 });
  await expect(panel(page)).toHaveAttribute('data-presentation', 'overlay');
  await expect(page.getByRole('textbox', { name: 'AI 요청', exact: true })).toHaveValue('창 크기와 관계없이 보존할 요청 초안');
  expect(await preference(page)).toEqual(saved);
  const room = await page.locator('#document-scroll').boundingBox();
  expect(room!.width).toBeGreaterThanOrEqual(640);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(panel(page)).toHaveAttribute('data-presentation', 'docked');
  expect(await preference(page)).toEqual(saved);
  expect(await (await request.get(`${API}/projects/${project.id}`)).json()).toEqual(project);
});

test('UXP02: temporary floating containment restores preferred size when the viewport grows again', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await openPanel(page);
  await page.getByRole('button', { name: '창으로 띄우기', exact: true }).click();
  const resize = page.getByRole('button', { name: 'AI 창 크기 조절', exact: true });
  await resize.focus();
  await page.keyboard.press('Shift+ArrowRight');
  const before = await panel(page).boundingBox(), saved = await preference(page);
  await page.setViewportSize({ width: 600, height: 500 });
  await expect.poll(async () => (await panel(page).boundingBox())!.width).toBe(340);
  expect(await preference(page)).toEqual(saved);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(async () => (await panel(page).boundingBox())!.width).toBe(before!.width);
  expect(await preference(page)).toEqual(saved);
});

test('UXP03: compact PRD outline opens by request, returns focus on Escape and navigates to an individual item', async ({ page, request }) => {
  let project = await seedProject(request);
  project = await saveArtifact(request, project, 'prd', [...project.prd, { id: `${project.id}-second-overview`, revision: 0, section: 'overview', title: '두 번째 개요', content: '<p>문서 구조에서 직접 이동할 항목입니다.</p>' }]);
  await page.setViewportSize({ width: 720, height: 500 });
  await page.goto(`/#project/${project.id}`);
  const outline = page.getByRole('complementary', { name: 'PRD 문서 구조', exact: true });
  const toggle = page.getByRole('button', { name: '문서 구조 열기', exact: true });
  await expect(outline).toBeHidden();
  await toggle.click();
  await expect(outline).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(outline).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await outline.getByRole('button', { name: '두 번째 개요', exact: true }).click();
  await expect(outline).toBeHidden();
  await expect(page.locator(`[id="prd-item-${project.id}-second-overview"]`)).toBeFocused();
  await expect(page.getByRole('textbox', { name: '두 번째 개요 내용', exact: true })).toHaveCSS('font-size', '14px');
});

test('UXP04: a late generation acknowledgement retains the new composer draft typed while waiting', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await openPanel(page);
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/projects/*/ai/runs', async route => {
    calls++;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  const composer = page.getByRole('textbox', { name: 'AI 요청', exact: true });
  await composer.fill('첫 번째 요청');
  await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await composer.fill('응답을 기다리는 동안 작성한 다음 요청');
  await page.getByRole('button', { name: '창으로 띄우기', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  await expect(composer).toHaveValue('응답을 기다리는 동안 작성한 다음 요청');
  expect(calls).toBe(1);
});

test('UXR01: review identifies target and counts, stacks narrow comparison, and blocks duplicate approval or dismissal until saving completes', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await openPanel(page);
  await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill('서비스 소개 문장을 보완해 줘');
  await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 변경 제안 검토', exact: true });
  await expect(dialog.locator('.ai-review-target')).toContainText(`${project.name} / PRD`);
  await expect(dialog.locator('.ai-review-counts')).toContainText('수정 1');
  expect(await (await request.get(`${API}/projects/${project.id}`)).json()).toEqual(project);
  await page.setViewportSize({ width: 720, height: 500 });
  const before = await dialog.locator('.proposal-before').boundingBox(), after = await dialog.locator('.proposal-after').boundingBox();
  expect(after!.y).toBeGreaterThan(before!.y);
  const approve = dialog.getByRole('button', { name: '선택 승인', exact: true });
  await expect(approve).toContainText('1');
  const footer = await approve.boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(500);
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/proposals/*/resolve', async route => { calls++; await gate; await route.continue(); });
  await approve.click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(approve).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '닫기', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  expect(calls).toBe(1);
  release();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`${API}/projects/${project.id}`)).json()).prd[0].content).toContain('AI가 제안한');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toContainText('AI가 제안한');
  expect(calls).toBe(1);
});
