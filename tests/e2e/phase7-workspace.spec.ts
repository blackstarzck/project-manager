import { expect, test, type Page } from '@playwright/test';
import type { Project } from '../../shared/schema.js';
import { getProject, flattenElements } from '../phase2-fixtures.js';
import { pageHeader, seedGeneratedNavigation, seedMissingNavigation, seedSimilarNavigation } from '../phase7-fixtures.js';

async function openEditor(page: Page, project: Project) {
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
}
async function analyzeExtended(page: Page) {
  await page.getByRole('button', { name: '공통 내비게이션 찾기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '공통 내비게이션 자동 분석', exact: true });
  await dialog.getByRole('checkbox', { name: '유사 메뉴와 없는 영역도 찾기', exact: true }).check();
  return dialog;
}
const confirmName = '선택한 영역의 변경 내용을 확인했습니다';
const applyName = '선택한 공통 영역 연결';

test('XU01: changed menu review defaults off, shows before and after, requires confirmation and preserves working modal links', async ({ page, request }) => {
  const original = await seedSimilarNavigation(request); await openEditor(page, original);
  const mutations: string[] = [];
  page.on('request', req => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) mutations.push(req.url()); });
  let dialog = await analyzeExtended(page);
  await expect(dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`)).not.toBeChecked();
  await expect(dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[2].id}`)).toBeChecked();
  await expect(dialog.getByText(/책 찾아보기/).first()).toBeVisible();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  expect(mutations).toEqual([]); expect(await getProject(request, original.id)).toEqual(original);
  dialog = await analyzeExtended(page);
  await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).uncheck();
  await dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`).check();
  await expect(dialog.getByRole('button', { name: applyName, exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: confirmName, exact: true }).check();
  await page.screenshot({ path: 'tests/artifacts/phase7-similar-navigation-review.png', fullPage: true });
  await dialog.getByRole('button', { name: applyName, exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync?.header?.sourceScreenId).toBe(original.wireframes[0].id);
  const saved = await getProject(request, original.id);
  expect(flattenElements(saved.wireframes[1].elements).map(element => element.id)).toEqual(flattenElements(original.wireframes[1].elements).map(element => element.id));
  expect(saved.wireframes[1].elements.slice(1)).toEqual(original.wireframes[1].elements.slice(1));
  expect(saved.wireframes[2]).toEqual(original.wireframes[2]);
  expect(mutations.filter(url => url.includes('/ai/'))).toEqual([]);
  await page.getByTestId(`screen-${original.wireframes[1].id}`).click();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByRole('button', { name: '본문에서 안내 열기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '공통 이용 안내', exact: true })).toBeVisible();
});

test('XU02: reviewed missing header creation saves only that screen and undo restores its original body and absent binding', async ({ page, request }) => {
  const original = await seedMissingNavigation(request); await openEditor(page, original);
  const dialog = await analyzeExtended(page);
  await expect(dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[2].id}`)).not.toBeChecked();
  await expect(dialog.getByLabel('추가할 공통 영역 미리보기', { exact: true })).toContainText('우리 동네 도서관');
  await expect(dialog.getByLabel('추가할 공통 영역 미리보기', { exact: true })).toContainText('도서 검색');
  await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).uncheck();
  await dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[2].id}`).check();
  await dialog.getByRole('checkbox', { name: confirmName, exact: true }).check();
  await dialog.getByRole('button', { name: applyName, exact: true }).click();
  await expect.poll(async () => !!pageHeader((await getProject(request, original.id)).wireframes[2])).toBe(true);
  const saved = await getProject(request, original.id);
  expect(saved.wireframes[2].elements.slice(1)).toEqual(original.wireframes[2].elements);
  expect(saved.wireframes[0]).toEqual(original.wireframes[0]); expect(saved.wireframes[1]).toEqual(original.wireframes[1]);
  await page.getByTestId(`screen-${original.wireframes[2].id}`).click();
  await page.getByRole('button', { name: '화면 편집 실행 취소', exact: true }).click();
  await expect.poll(async () => !!pageHeader((await getProject(request, original.id)).wireframes[2])).toBe(false);
  const undone = await getProject(request, original.id);
  expect(undone.wireframes[2].elements).toEqual(original.wireframes[2].elements); expect(undone.wireframes[2].navigationSync).toBeUndefined();
  await page.reload(); await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  expect((await getProject(request, original.id)).wireframes[2].elements).toEqual(original.wireframes[2].elements);
});

test('XU03: generated menu preview creates no drafts until review and its real buttons navigate among current same-device screens', async ({ page, request }) => {
  const original = await seedGeneratedNavigation(request); await openEditor(page, original);
  const mutations: string[] = [];
  page.on('request', req => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) mutations.push(req.url()); });
  const dialog = await analyzeExtended(page);
  await expect(dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`)).not.toBeChecked();
  await expect(dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[2].id}`)).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: applyName, exact: true })).toBeDisabled();
  expect(mutations).toEqual([]); expect(await getProject(request, original.id)).toEqual(original);
  await dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`).check();
  await dialog.getByRole('checkbox', { name: confirmName, exact: true }).check();
  await page.screenshot({ path: 'tests/artifacts/phase7-generated-navigation-review.png', fullPage: true });
  await dialog.getByRole('button', { name: applyName, exact: true }).click();
  await expect.poll(async () => !!pageHeader((await getProject(request, original.id)).wireframes[0])).toBe(true);
  const saved = await getProject(request, original.id);
  for (const index of [0, 1]) expect(saved.wireframes[index].elements.slice(1)).toEqual(original.wireframes[index].elements);
  expect(saved.wireframes[2]).toEqual(original.wireframes[2]); expect(saved.wireframes[3]).toEqual(original.wireframes[3]);
  expect(mutations.filter(url => url.includes('/ai/'))).toEqual([]);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByRole('button', { name: original.wireframes[1].name, exact: true }).click();
  await expect(page.getByTestId(`wire-element-${original.wireframes[1].id}-generated-fixture-title`).getByRole('heading', { name: original.wireframes[1].name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '개별 안내 열기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '개별 안내', exact: true })).toContainText(`${original.wireframes[1].name} 전용 안내`);
});

test('XU04: stale extended reviews require reanalysis and new confirmation without losing the latest manual content', async ({ page, request }) => {
  const original = await seedSimilarNavigation(request); await openEditor(page, original);
  let markCommitted!: () => void, release!: () => void;
  const committed = new Promise<void>(resolve => { markCommitted = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const routePattern = `**/api/projects/${original.id}/artifacts/wireframes`;
  await page.route(routePattern, async route => { const response = await route.fetch(); markCommitted(); await released; await route.fulfill({ response }); });
  try {
    await page.getByTestId(`layer-${original.wireframes[0].id}-infer-body-copy`).click();
    await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('유사 메뉴 검토 직전 수동 본문');
    await committed;
    const dialog = await analyzeExtended(page);
    await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).uncheck();
    await dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`).check();
    await dialog.getByRole('checkbox', { name: confirmName, exact: true }).check();
    await expect(dialog.getByRole('button', { name: applyName, exact: true })).toBeEnabled();
    release();
    await expect(dialog.getByRole('alert')).toContainText('분석 이후 화면 내용이나 버전이 변경되었습니다');
    await expect(dialog.getByRole('button', { name: applyName, exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: '다시 분석', exact: true }).click();
    await expect(dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`)).not.toBeChecked();
    await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '공통 영역 후보 전체 선택', exact: true }).uncheck();
    await dialog.getByTestId(`navigation-inference-target-header-${original.wireframes[1].id}`).check();
    await expect(dialog.getByRole('checkbox', { name: confirmName, exact: true })).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: applyName, exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: confirmName, exact: true }).check();
    await dialog.getByRole('button', { name: applyName, exact: true }).click();
    await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync?.header?.sourceScreenId).toBe(original.wireframes[0].id);
    expect(JSON.stringify((await getProject(request, original.id)).wireframes[0].elements)).toContain('유사 메뉴 검토 직전 수동 본문');
  } finally { release(); await page.unroute(routePattern); }
});

