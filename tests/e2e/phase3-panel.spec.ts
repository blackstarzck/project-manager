import { expect, test } from '@playwright/test';
import { seedProject } from '../fixtures.js';

test('P03: floating panel uses original proportional maxima with minimum-size precedence and small-viewport containment', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.addInitScript(() => localStorage.setItem('planit.ai-panel.v1', JSON.stringify({ version: 1, mode: 'floating', open: true, dockWidth: 432, floating: { x: 900, y: 700, width: 5000, height: 5000 } })));
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'AI 기획 도우미', exact: true });
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeCloseTo(550, 0);
  expect(box.height).toBeCloseTo(680, 0);
  expect(box.x + box.width).toBeLessThanOrEqual(1000);
  expect(box.y + box.height).toBeLessThanOrEqual(800);
  await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill('화면을 줄여도 유지할 요청');
  await page.setViewportSize({ width: 600, height: 500 });
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(340);
  expect((await panel.boundingBox())!.height).toBe(425);
  await expect(page.getByRole('textbox', { name: 'AI 요청', exact: true })).toHaveValue('화면을 줄여도 유지할 요청');
  await page.screenshot({ path: 'tests/artifacts/phase3-floating-ratio.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 300 });
  const tiny = (await panel.boundingBox())!;
  expect(tiny.x).toBeGreaterThanOrEqual(0);
  expect(tiny.y).toBeGreaterThanOrEqual(0);
  expect(tiny.x + tiny.width).toBeLessThanOrEqual(320);
  expect(tiny.y + tiny.height).toBeLessThanOrEqual(300);
});
