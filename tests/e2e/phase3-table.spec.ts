import { expect, test } from '@playwright/test';
import { flattenElements, getProject, seedNestedProject } from '../phase2-fixtures.js';

test('T01: sequential header typing and autosave never truncate existing table cells', async ({ page, request }) => {
  const project = await seedNestedProject(request);
  const tableId = `${project.id}-nested-table`;
  const originalTable = flattenElements(project.wireframes[0].elements).find(element => element.id === tableId)!;
  const savedTable = async () => flattenElements((await getProject(request, project.id)).wireframes[0].elements).find(element => element.id === tableId)!;
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByTestId(`layer-${tableId}`).click();
  const headers = page.getByRole('textbox', { name: '표 열 제목', exact: true });
  await headers.focus();
  await headers.press('ControlOrMeta+A');
  await headers.pressSequentially('N', { delay: 80 });
  // Wait for the intermediate keystroke to reach the database, not just the input.
  await expect.poll(async () => (await savedTable()).columns?.[0]).toBe('N');
  expect((await savedTable()).rows).toEqual(originalTable.rows);
  await headers.pressSequentially('ame | Status', { delay: 45 });
  await headers.blur();
  await expect.poll(async () => (await savedTable()).columns).toEqual(['Name', 'Status']);
  expect((await savedTable()).rows).toEqual(originalTable.rows);
  await page.reload();
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByTestId(`layer-${tableId}`).click();
  await expect(headers).toHaveValue('Name | Status');
  expect((await savedTable()).rows).toEqual(originalTable.rows);
});

test('T02: row delimiters and newlines can be typed, new columns expand safely, explicit deletion is undoable', async ({ page, request }) => {
  const project = await seedNestedProject(request);
  const tableId = `${project.id}-nested-table`;
  const savedTable = async () => flattenElements((await getProject(request, project.id)).wireframes[0].elements).find(element => element.id === tableId)!;
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByTestId(`layer-${tableId}`).click();
  const rows = page.getByRole('textbox', { name: '표 행 데이터', exact: true });
  await rows.focus();
  await rows.press('ControlOrMeta+A');
  await rows.pressSequentially('Book | Available | First', { delay: 25 });
  await rows.press('Enter');
  await rows.pressSequentially('Forest | Wait | Second', { delay: 25 });
  await rows.blur();
  const expectedRows = [['Book', 'Available', 'First'], ['Forest', 'Wait', 'Second']];
  await expect.poll(async () => (await savedTable()).rows).toEqual(expectedRows);
  expect((await savedTable()).columns).toHaveLength(3);
  const beforeDelete = await savedTable();
  await page.getByRole('button', { name: '표 2열 삭제', exact: true }).click();
  await expect.poll(async () => (await savedTable()).rows).toEqual([['Book', 'First'], ['Forest', 'Second']]);
  await page.getByRole('button', { name: '화면 편집 실행 취소', exact: true }).click();
  await expect.poll(async () => (await savedTable()).rows).toEqual(expectedRows);
  expect((await savedTable()).columns).toEqual(beforeDelete.columns);
  await expect(rows).toHaveValue('Book | Available | First\nForest | Wait | Second');
  await page.reload();
  expect((await savedTable()).rows).toEqual(expectedRows);
});

test('T03: over-limit table input is explained without silently truncating saved data', async ({ page, request }) => {
  const project = await seedNestedProject(request);
  const tableId = `${project.id}-nested-table`;
  const savedTable = async () => flattenElements((await getProject(request, project.id)).wireframes[0].elements).find(element => element.id === tableId)!;
  const original = await savedTable();
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByTestId(`layer-${tableId}`).click();
  const headers = page.getByRole('textbox', { name: '표 열 제목', exact: true });
  const invalid = Array.from({ length: 13 }, (_, i) => `Column ${i}`).join(' | ');
  await headers.fill(invalid);
  await expect(page.getByRole('alert').filter({ hasText: '열은 12개' })).toBeVisible();
  await expect(headers).toHaveValue(invalid);
  expect(await savedTable()).toEqual(original);
  await headers.fill('책 제목 | 상태');
  await headers.blur();
  await expect.poll(async () => (await savedTable()).columns).toEqual(['책 제목', '상태']);
  expect((await savedTable()).rows).toEqual(original.rows);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
