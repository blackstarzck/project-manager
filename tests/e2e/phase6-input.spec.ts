import { expect, test } from '@playwright/test';
import { flattenElements, getProject, seedNestedProject } from '../phase2-fixtures.js';

test('IC01: pasting text beyond 4000 characters cannot create an unsavable element draft', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const titleId = `${original.id}-nested-nested-title`;
  await page.goto(`/#project/${original.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByTestId(`layer-${titleId}`).click();
  const textbox = page.getByRole('textbox', { name: '요소 내용', exact: true });
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/projects/${original.id}/artifacts/wireframes`));
  await textbox.fill('가'.repeat(4001));
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByRole('status').filter({ hasText: '모든 변경 저장됨' })).toBeVisible();
  expect(await textbox.inputValue()).toHaveLength(4000);
  expect(flattenElements((await getProject(request, original.id)).wireframes[0].elements).find(element => element.id === titleId)?.text).toBe('가'.repeat(4000));
  await page.reload(); await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByTestId(`layer-${titleId}`).click();
  expect(await textbox.inputValue()).toBe('가'.repeat(4000));
  await expect(page.getByRole('button', { name: '저장 재시도', exact: true })).toHaveCount(0);
});
