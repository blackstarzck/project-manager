import { expect, test, type Page } from '@playwright/test';
import { seedProject } from '../fixtures.js';

const panel = (page: Page) => page.getByRole('complementary', { name: 'AI 기획 도우미', exact: true });
const getState = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('planit.ai-panel.v1') ?? 'null'));
async function openPanel(page: Page) {
  if (!(await page.getByRole('textbox', { name: 'AI 요청', exact: true }).isVisible())) await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
}
async function assertWithinViewport(page: Page) {
  const box = await panel(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('P01: detachable AI panel preserves composer and running proposal through detach, dock and hide', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await openPanel(page);
  const composer = page.getByRole('textbox', { name: 'AI 요청', exact: true });
  await composer.fill('[QA_DELAY] 분리 패널에서도 보존할 요청');
  await page.getByRole('button', { name: '창으로 띄우기', exact: true }).click();
  await expect(composer).toHaveValue('[QA_DELAY] 분리 패널에서도 보존할 요청');
  await expect(page.getByRole('button', { name: '패널로 되돌리기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
  await page.getByRole('button', { name: '패널로 되돌리기', exact: true }).click();
  await page.getByRole('button', { name: 'AI 패널 닫기', exact: true }).click();
  await openPanel(page);
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  await composer.fill('다음에 보낼 작성 중 요청');
  await page.getByRole('button', { name: '창으로 띄우기', exact: true }).click();
  await page.getByRole('button', { name: 'AI 패널 닫기', exact: true }).click();
  await openPanel(page);
  await expect(composer).toHaveValue('다음에 보낼 작성 중 요청');
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI 변경 제안 검토', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '선택 거절', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('P02: floating drag and resize persist, keyboard controls work, and reduced viewport clamps bounds', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await openPanel(page);
  await page.getByRole('button', { name: '창으로 띄우기', exact: true }).click();
  const before = await panel(page).boundingBox();
  const handle = page.getByLabel('AI 창 이동', { exact: true });
  const moveBox = await handle.boundingBox();
  await page.mouse.move(moveBox!.x + 40, moveBox!.y + moveBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(moveBox!.x + 210, moveBox!.y + moveBox!.height / 2 - 80, { steps: 8 });
  await page.mouse.up();
  const moved = await panel(page).boundingBox();
  expect(moved!.x).toBeGreaterThan(before!.x + 100);
  const resize = page.getByLabel('AI 창 크기 조절', { exact: true });
  const resizeBox = await resize.boundingBox();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox!.x + resizeBox!.width / 2 + 120, resizeBox!.y + resizeBox!.height / 2 - 80, { steps: 8 });
  await page.mouse.up();
  const resized = await panel(page).boundingBox();
  expect(resized!.width).toBeGreaterThan(moved!.width + 80);
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  const keyboardMoved = await panel(page).boundingBox();
  expect(keyboardMoved!.x).toBeGreaterThan(resized!.x);
  const saved = await getState(page);
  await page.reload();
  await openPanel(page);
  await expect(page.getByRole('button', { name: '패널로 되돌리기', exact: true })).toBeVisible();
  expect((await getState(page)).floating).toEqual(saved.floating);
  await assertWithinViewport(page);
  await page.setViewportSize({ width: 600, height: 500 });
  await assertWithinViewport(page);
  await page.screenshot({ path: 'tests/artifacts/phase2-floating-small.png', fullPage: true });
  await page.getByRole('button', { name: '패널로 되돌리기', exact: true }).click();
  await expect(page.getByRole('button', { name: '창으로 띄우기', exact: true })).toBeVisible();
  await page.reload();
  await openPanel(page);
  await expect(page.getByRole('button', { name: '창으로 띄우기', exact: true })).toBeVisible();
  const beforeDockResize = (await getState(page)).dockWidth;
  await page.getByRole('separator', { name: 'AI 패널 너비 조절', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  expect((await getState(page)).dockWidth).toBeLessThan(beforeDockResize);
  const dockWidth = (await getState(page)).dockWidth;
  await page.reload();
  await openPanel(page);
  expect((await getState(page)).dockWidth).toBe(dockWidth);
});
