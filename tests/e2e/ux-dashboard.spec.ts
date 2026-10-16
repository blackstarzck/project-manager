import { expect, test } from '@playwright/test';
import { API, createProject, mutationHeaders } from '../fixtures.js';

test('UX-D01: a late trash response cannot replace active projects and project menus support keyboard navigation', async ({ page, request }) => {
  const active = await createProject(request, '현재 프로젝트');
  const archived = await createProject(request, '지연된 휴지통 프로젝트');
  const archive = await request.patch(`${API}/projects/${archived.id}`, { headers: mutationHeaders, data: { expectedRevision: archived.revision, archived: true } });
  expect(archive.ok(), await archive.text()).toBeTruthy();
  let releaseTrash!: () => void;
  const gate = new Promise<void>(resolve => { releaseTrash = resolve; });
  let trashRequested = false;
  await page.route(/\/api\/projects(?:\?archived=true)?$/, async route => {
    const response = await route.fetch();
    const archivedQuery = route.request().url().endsWith('?archived=true');
    if (archivedQuery) { trashRequested = true; await gate; }
    const values = await response.json() as { id: string }[];
    await route.fulfill({ response, json: values.filter(value => value.id === (archivedQuery ? archived.id : active.id)) });
  });
  await page.goto('/');
  const activeProject = page.getByRole('button', { name: `${active.name} 프로젝트 열기`, exact: true });
  await expect(activeProject).toBeVisible();
  await page.getByRole('button', { name: '휴지통', exact: true }).click();
  await expect.poll(() => trashRequested).toBe(true);
  await page.getByRole('button', { name: /^모든 프로젝트/ }).click();
  await expect(activeProject).toBeVisible();
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/projects?archived=true'));
  releaseTrash();
  await (await lateResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole('heading', { name: '나의 프로젝트', exact: true })).toBeVisible();
  await expect(activeProject).toBeVisible();
  await expect(page.getByRole('button', { name: `${archived.name} 프로젝트 열기`, exact: true })).toHaveCount(0);
  const menu = page.getByRole('button', { name: `${active.name} 프로젝트 메뉴`, exact: true });
  await menu.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '프로젝트 복제', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: '휴지통으로 이동', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test('UX-D02: create failure is announced inside the dialog, preserves its draft and allows a successful retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/projects', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    if (++attempts === 1) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '검수용 프로젝트 생성 실패입니다. 다시 시도해 주세요.' }) });
    return route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '새 프로젝트', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '새 프로젝트 만들기', exact: true });
  const name = '생성 오류 뒤에도 보존하는 프로젝트';
  const description = '재시도 전까지 제목과 설명을 그대로 유지해야 합니다.';
  await dialog.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: '프로젝트 설명', exact: true }).fill(description);
  await dialog.getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('검수용 프로젝트 생성 실패');
  await expect(dialog.getByRole('textbox', { name: '프로젝트 이름', exact: true })).toHaveValue(name);
  await expect(dialog.getByRole('textbox', { name: '프로젝트 설명', exact: true })).toHaveValue(description);
  await expect(dialog.getByRole('button', { name: '프로젝트 만들기', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'PRD', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.breadcrumbs strong')).toHaveText(name);
  expect(attempts).toBe(2);
});
