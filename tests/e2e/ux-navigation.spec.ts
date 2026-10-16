import { expect, test } from '@playwright/test';
import { API, createProject, seedProject } from '../fixtures.js';

test('UX-N01: artifact deep links, legacy links, reload and browser history agree with the selected tab', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}/features`);
  await expect(page.getByRole('tab', { name: '기능명세', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '기능명세', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: '기능명세', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '유저플로우', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}/flow$`));
  await page.goBack();
  await expect(page.getByRole('tab', { name: '기능명세', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page.getByRole('tab', { name: '유저플로우', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('tab', { name: 'PRD', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}/prd$`));
  await page.goto(`/#project/${project.id}/unknown-artifact`);
  await expect(page.getByRole('tabpanel', { name: 'PRD', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}/prd$`));
});

test('UX-N02: manual keyboard tabs wait for save and preserve the AI draft without remounting the panel', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.addInitScript(() => localStorage.setItem('planit.ai-panel.v1', JSON.stringify({ version: 1, mode: 'docked', open: true, dockWidth: 360, floating: { x: 80, y: 80, width: 412, height: 640 } })));
  await page.goto(`/#project/${project.id}/prd`);
  await expect(page.getByRole('complementary', { name: 'AI 기획 도우미', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'AI 패널 펼치기', exact: true }).click();
  await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill('탭 이동 후에도 유지할 요청 초안');
  let releaseSave!: () => void;
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  let saveRequested = false;
  await page.route(`**/api/projects/${project.id}/artifacts/prd`, async route => {
    saveRequested = true; await gate; await route.continue();
  });
  await page.getByRole('textbox', { name: '서비스 소개 내용', exact: true }).fill('탭 전환 전에 저장해야 하는 한글 초안');
  const prd = page.getByRole('tab', { name: 'PRD', exact: true });
  const features = page.getByRole('tab', { name: '기능명세', exact: true });
  await prd.focus(); await page.keyboard.press('ArrowRight');
  await expect(features).toBeFocused();
  await expect(prd).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => saveRequested).toBe(true);
  await expect(prd).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`/prd$`));
  releaseSave();
  await expect(features).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'AI 요청', exact: true })).toHaveValue('탭 이동 후에도 유지할 요청 초안');
  expect((await (await request.get(`${API}/projects/${project.id}`)).json()).prd[0].content).toContain('탭 전환 전에 저장해야 하는 한글 초안');
  await expect(page.locator('.app-rail').getByRole('button')).toHaveCount(4);
});

test('UX-N03: save failure keeps tab, address and draft for clicks and Back, then permits retry', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}/prd`);
  await page.getByRole('tab', { name: '기능명세', exact: true }).click();
  await page.getByRole('button', { name: '디렉토리 뷰', exact: true }).click();
  await page.route(`**/api/projects/${project.id}/artifacts/features`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '검수용 저장 실패' }) }));
  await page.getByRole('textbox', { name: '기능 제목', exact: true }).fill('실패해도 남아 있어야 하는 기능 초안');
  await page.getByRole('tab', { name: 'PRD', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('검수용 저장 실패');
  await expect(page.getByRole('tab', { name: '기능명세', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}/features$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}/features$`));
  await expect(page.getByRole('textbox', { name: '기능 제목', exact: true })).toHaveValue('실패해도 남아 있어야 하는 기능 초안');
  await page.unroute(`**/api/projects/${project.id}/artifacts/features`);
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'PRD', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}/prd$`));
  await page.goForward();
  await expect(page.getByRole('tab', { name: '기능명세', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await (await request.get(`${API}/projects/${project.id}`)).json()).features[0].title).toBe('실패해도 남아 있어야 하는 기능 초안');
});

test('UX-N04: direct project hash navigation rejects a late response from a superseded project', async ({ page, request }) => {
  const original = await seedProject(request), slow = await createProject(request, '느린 프로젝트'), latest = await createProject(request, '마지막 프로젝트');
  await page.goto(`/#project/${original.id}/prd`);
  await expect(page.getByRole('tab', { name: 'PRD', exact: true })).toBeVisible();
  let releaseProject!: () => void;
  const gate = new Promise<void>(resolve => { releaseProject = resolve; });
  let requested = false;
  await page.route(`**/api/projects/${slow.id}`, async route => { requested = true; await gate; await route.fulfill({ contentType: 'application/json', body: JSON.stringify(slow) }); });
  await page.evaluate(id => { location.hash = `project/${id}/features`; }, slow.id);
  await expect.poll(() => requested).toBe(true);
  await page.evaluate(id => { location.hash = `project/${id}/wireframes`; }, latest.id);
  await expect(page.locator('.breadcrumbs strong')).toHaveText(latest.name);
  await expect(page.getByRole('tab', { name: '와이어프레임', exact: true })).toHaveAttribute('aria-selected', 'true');
  const response = page.waitForResponse(result => result.url().endsWith(`/api/projects/${slow.id}`));
  releaseProject(); await response;
  await expect(page.locator('.breadcrumbs strong')).toHaveText(latest.name);
  await expect(page).toHaveURL(new RegExp(`#project/${latest.id}/wireframes$`));
});

test('UX-N05: failed project hash load restores the current document and keeps its editor usable', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}/features`);
  await expect(page.getByRole('tab', { name: '기능명세', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => { location.hash = 'project/missing-ux-project/flow'; });
  await expect(page).toHaveURL(new RegExp(`#project/${project.id}/features$`));
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('tab', { name: 'PRD', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toBeEditable();
});
