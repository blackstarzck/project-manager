import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../shared/schema.js';
import { getProject, flattenElements } from '../phase2-fixtures.js';
import { seedInferenceProject } from '../phase6-fixtures.js';

async function openEditor(page: Page, project: Project) {
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
}
async function analyze(page: Page) {
  await page.getByRole('button', { name: '공통 내비게이션 찾기', exact: true }).click();
  return page.getByRole('dialog', { name: '공통 내비게이션 자동 분석', exact: true });
}

test('IU01: discovery and cancel never mutate data; reviewed selection preserves existing IDs and working body-to-header modal links', async ({ page, request }) => {
  const original = await seedInferenceProject(request);
  await openEditor(page, original);
  const mutations: string[] = [];
  page.on('request', req => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) mutations.push(req.url()); });
  let dialog = await analyze(page);
  await expect(dialog.getByRole('status')).toContainText('공통 영역 후보 3개 · 연결 대상 6개');
  await expect(dialog.getByRole('group', { name: '공통 내비게이션 연결 후보', exact: true }).getByRole('checkbox')).toHaveCount(6);
  await expect(dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: '유사 메뉴와 없는 영역도 찾기', exact: true })).not.toBeChecked();
  await expect(dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[3].id}`)).toHaveCount(0);
  await page.screenshot({ path: 'tests/artifacts/phase6-navigation-inference.png', fullPage: true });
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  expect(mutations).toEqual([]); expect(await getProject(request, original.id)).toEqual(original);
  dialog = await analyze(page);
  await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).uncheck();
  await expect(dialog.getByRole('button', { name: '선택한 공통 영역 연결', exact: true })).toBeDisabled();
  await dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`).check();
  await dialog.getByRole('button', { name: '선택한 공통 영역 연결', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync?.header?.sourceScreenId).toBe(original.wireframes[0].id);
  const saved = await getProject(request, original.id);
  expect(saved.wireframes.map(screen => screen.elements)).toEqual(original.wireframes.map(screen => screen.elements));
  expect(saved.wireframes[2]).toEqual(original.wireframes[2]); expect(saved.wireframes[3]).toEqual(original.wireframes[3]);
  expect(Object.keys(saved.wireframes[1].navigationSync!)).toEqual(['header']);
  await page.getByTestId(`screen-${original.wireframes[1].id}`).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByRole('button', { name: '본문에서 안내 열기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '공통 이용 안내', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('회원증을 준비해 주세요.', { exact: true })).toBeVisible();
});

test('IU02: multi-target inference undo affects only the selected screen and later source edits preserve detached target content', async ({ page, request }) => {
  const original = await seedInferenceProject(request); await openEditor(page, original);
  const dialog = await analyze(page);
  await dialog.getByRole('button', { name: '선택한 공통 영역 연결', exact: true }).click();
  await expect.poll(async () => Object.keys((await getProject(request, original.id)).wireframes[2].navigationSync || {}).length).toBe(3);
  const linked = await getProject(request, original.id);
  await page.getByTestId(`screen-${original.wireframes[1].id}`).click();
  await page.getByRole('button', { name: '화면 편집 실행 취소', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync).toBeUndefined();
  expect((await getProject(request, original.id)).wireframes[2].navigationSync).toEqual(linked.wireframes[2].navigationSync);
  await page.getByTestId(`screen-${original.wireframes[0].id}`).click();
  await page.getByTestId(`layer-${original.wireframes[0].id}-infer-brand`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('연결한 화면에만 반영되는 이름');
  await expect.poll(async () => flattenElements((await getProject(request, original.id)).wireframes[2].elements).find(element => element.id.endsWith('-infer-brand'))?.text).toBe('연결한 화면에만 반영되는 이름');
  const changed = await getProject(request, original.id);
  expect(changed.wireframes[1].elements).toEqual(original.wireframes[1].elements);
  expect(changed.wireframes[3]).toEqual(original.wireframes[3]);
  await page.getByRole('button', { name: '화면 편집 실행 취소', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[2].elements).toEqual(original.wireframes[2].elements);
  await page.reload(); await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  const reloaded = await getProject(request, original.id);
  expect(reloaded.wireframes[1].navigationSync).toBeUndefined(); expect(reloaded.wireframes[2].navigationSync).toEqual(linked.wireframes[2].navigationSync);
});

test('IU03: a completed delayed autosave invalidates an open inference snapshot until explicit reanalysis', async ({ page, request }) => {
  const original = await seedInferenceProject(request); await openEditor(page, original);
  let markCommitted!: () => void, release!: () => void;
  const committed = new Promise<void>(resolve => { markCommitted = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const routePattern = `**/api/projects/${original.id}/artifacts/wireframes`;
  await page.route(routePattern, async route => { const response = await route.fetch(); markCommitted(); await released; await route.fulfill({ response }); });
  try {
    await page.getByTestId(`layer-${original.wireframes[0].id}-infer-body-copy`).click();
    await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('분석 직전 수동 본문 변경');
    await committed;
    const dialog = await analyze(page);
    await expect(dialog.getByRole('button', { name: '선택한 공통 영역 연결', exact: true })).toBeEnabled();
    release();
    await expect(dialog.getByRole('alert')).toContainText('분석 이후 화면 내용이나 버전이 변경되었습니다');
    await expect(dialog.getByRole('button', { name: '선택한 공통 영역 연결', exact: true })).toBeDisabled();
    expect((await getProject(request, original.id)).wireframes.every(screen => !screen.navigationSync)).toBe(true);
    await dialog.getByRole('button', { name: '다시 분석', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: '선택한 공통 영역 연결', exact: true }).click();
    await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync?.header?.sourceScreenId).toBe(original.wireframes[0].id);
    expect(JSON.stringify((await getProject(request, original.id)).wireframes[0].elements)).toContain('분석 직전 수동 본문 변경');
  } finally { release(); await page.unroute(routePattern); }
});

test('IU04: discovery exclusion persists without removing explicit bindings or content, and no-match analysis stays read-only', async ({ page, request }) => {
  const original = await seedInferenceProject(request); await openEditor(page, original);
  const initial = await analyze(page);
  await initial.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).uncheck();
  await initial.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`).check();
  await initial.getByRole('button', { name: '선택한 공통 영역 연결', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync?.header?.sourceScreenId).toBe(original.wireframes[0].id);
  const binding = (await getProject(request, original.id)).wireframes[1].navigationSync;
  for (const screen of original.wireframes.slice(0, 2)) {
    await page.getByTestId(`screen-${screen.id}`).click();
    await page.getByRole('checkbox', { name: '공통 내비게이션 자동 찾기에서 제외', exact: true }).check();
    await expect.poll(async () => (await getProject(request, original.id)).wireframes.find(item => item.id === screen.id)?.navigationInferenceExcluded).toBe(true);
  }
  const saved = await getProject(request, original.id);
  expect(saved.wireframes.map(screen => screen.elements)).toEqual(original.wireframes.map(screen => screen.elements));
  expect(saved.wireframes[1].navigationSync).toEqual(binding);
  await page.reload(); await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '공통 내비게이션 자동 찾기에서 제외', exact: true })).toBeChecked();
  const dialog = await analyze(page);
  await expect(dialog.getByText('자동으로 연결할 공통 영역이 없습니다.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '선택한 공통 영역 연결', exact: true })).toBeDisabled();
  await dialog.locator('summary').click();
  await expect(dialog.getByText('자동 찾기에서 제외한 화면입니다.', { exact: true }).first()).toBeVisible();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  expect(await getProject(request, original.id)).toEqual(saved);
});
