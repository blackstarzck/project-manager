import { expect, test } from '@playwright/test';
import { addFlowVersion, getProject, seedNestedProject } from '../phase2-fixtures.js';

test('D01: inactive flow references block feature deletion before local mutation and ordinary edits still save', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const blank = await addFlowVersion(request, original);
  expect(blank.flow.nodes).toHaveLength(0);
  await page.goto(`/#project/${original.id}`);
  await page.getByRole('tab', { name: '기능명세', exact: true }).click();
  await page.getByRole('button', { name: '디렉토리 뷰', exact: true }).click();
  const dialogPromise = page.waitForEvent('dialog');
  const clickDelete = page.getByRole('button', { name: '도서 예약 삭제', exact: true }).click();
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe('alert');
  expect(dialog.message()).toContain(original.flowGroups[0].name);
  expect(dialog.message()).toContain(original.flowGroups[0].versions[0].name);
  await dialog.accept();
  await clickDelete;
  expect((await getProject(request, original.id)).features).toEqual(original.features);
  await expect(page.getByRole('status').filter({ hasText: '모든 변경 저장됨' })).toBeVisible();
  await expect(page.getByRole('button', { name: '저장 재시도', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '기능 제목', exact: true }).fill('안전하게 수정한 도서 예약');
  await expect.poll(async () => (await getProject(request, original.id)).features[0].title).toBe('안전하게 수정한 도서 예약');
  expect((await getProject(request, original.id)).features).toHaveLength(original.features.length);
});
