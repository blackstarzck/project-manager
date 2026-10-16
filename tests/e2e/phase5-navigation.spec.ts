import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import type { Project } from '../../shared/schema.js';
import { flattenElements, getProject, seedNestedProject } from '../phase2-fixtures.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { linkedHeaders, seedThreePageProject } from '../phase5-fixtures.js';

async function linkHeader(page: Page, request: APIRequestContext, project: Project) {
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByRole('button', { name: '공통 내비게이션 적용', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '공통 내비게이션 적용', exact: true });
  await dialog.getByRole('checkbox', { name: '사이드바 적용', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: '푸터 적용', exact: true }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: '이후 변경도 자동 동기화', exact: true })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: '이후 변경도 자동 동기화', exact: true }).check();
  await dialog.getByRole('button', { name: '선택한 화면에 공통 영역 적용', exact: true }).click();
  await expect.poll(async () => (await getProject(request, project.id)).wireframes[1].navigationSync?.header?.sourceScreenId).toBe(project.wireframes[0].id);
  return getProject(request, project.id);
}

test('NS01: opt-in navigation propagates stable IDs, locks linked regions, preserves body, and unlink undo stays reversible', async ({ page, request, context }) => {
  const original = await seedNestedProject(request);
  const linked = await linkHeader(page, request, original);
  const binding = linked.wireframes[1].navigationSync!.header!;
  const targetTitle = binding.elementIdMap[`${original.id}-nested-title`];
  await page.getByTestId(`layer-${original.id}-nested-title`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('공유되는 새 도서관 이름');
  await expect.poll(async () => flattenElements((await getProject(request, original.id)).wireframes[1].elements).find(element => element.id === targetTitle)?.text).toBe('공유되는 새 도서관 이름');
  let saved = await getProject(request, original.id);
  expect(saved.wireframes[1].navigationSync).toEqual(linked.wireframes[1].navigationSync);
  const originalBody = flattenElements(original.wireframes[1].elements).find(element => element.type === 'body');
  expect(flattenElements(saved.wireframes[1].elements).find(element => element.type === 'body')).toEqual(originalBody);
  await page.getByTestId(`screen-${original.wireframes[1].id}`).click();
  await page.getByTestId(`layer-${targetTitle}`).click();
  await expect(page.getByRole('textbox', { name: '요소 내용', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'tests/artifacts/phase5-navigation-sync.png', fullPage: true });
  await page.getByRole('button', { name: '헤더 동기화 연결 해제', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync).toBeUndefined();
  const detached = await getProject(request, original.id);
  expect(detached.wireframes[1].elements).toEqual(saved.wireframes[1].elements);
  await page.getByRole('button', { name: '화면 편집 실행 취소', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync).toEqual(linked.wireframes[1].navigationSync);
  await page.reload(); await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  saved = await getProject(request, original.id);
  const html = await request.get(`${API}/projects/${original.id}/export?format=html`);
  const offline = await context.newPage(); await offline.setContent(await html.text());
  await offline.locator('body > header nav').getByRole('link', { name: original.wireframes[1].name, exact: true }).click();
  await expect(offline.locator('.screen.active').getByRole('heading', { name: '공유되는 새 도서관 이름', exact: true })).toBeVisible();
  await offline.close();
  expect(saved.wireframes[1].navigationSync).toEqual(linked.wireframes[1].navigationSync);
});

test('NS02: source-region deletion followed by source undo and follower undo must not silently relink a detached follower', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const linked = await linkHeader(page, request, original);
  const renderedFollower = linked.wireframes[1].elements;
  await page.getByTestId(`layer-${original.id}-nested-header`).click();
  await page.getByRole('button', { name: '요소와 하위 요소 삭제', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].navigationSync).toBeUndefined();
  expect((await getProject(request, original.id)).wireframes[1].elements).toEqual(renderedFollower);
  await page.getByRole('button', { name: '화면 편집 실행 취소', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[0].elements.some(element => element.id === `${original.id}-nested-header`)).toBe(true);
  await page.getByTestId(`screen-${original.wireframes[1].id}`).click();
  const undo = page.getByRole('button', { name: '화면 편집 실행 취소', exact: true });
  if (await undo.isEnabled()) await undo.click();
  await expect(page.getByRole('status').filter({ hasText: '모든 변경 저장됨' })).toBeVisible();
  const saved = await getProject(request, original.id);
  expect(saved.wireframes[1].navigationSync).toBeUndefined();
  expect(saved.wireframes[1].elements).toEqual(renderedFollower);
});

test('NS03: reapplying the same binding preserves IDs and body modal links; changing device detaches without content loss', async ({ page, request }) => {
  let original = await seedThreePageProject(request);
  const source = structuredClone(original.wireframes[0]);
  source.elements[0].children!.push({ id: `${original.id}-header-modal`, type: 'modal', text: '공유 헤더의 도움말', targetScreenId: null, children: [{ id: `${original.id}-header-modal-content`, type: 'text', text: '이용 안내 내용', targetScreenId: null }] });
  original = await saveArtifact(request, original, 'wireframes', [source, ...original.wireframes.slice(1)]);
  let screens = linkedHeaders(original);
  const modalId = screens[1].navigationSync!.header!.elementIdMap[`${original.id}-header-modal`];
  screens[1].elements.push({ id: `${original.id}-body-modal-button`, type: 'button', text: '본문에서 공유 도움말 열기', targetScreenId: null, action: 'openModal', targetElementId: modalId });
  original = await saveArtifact(request, original, 'wireframes', screens);
  await page.goto(`/#project/${original.id}`); await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByRole('button', { name: '공통 내비게이션 적용', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '공통 내비게이션 적용', exact: true });
  await dialog.getByRole('checkbox', { name: '사이드바 적용', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: '푸터 적용', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: '회원 대출 현황 공통 영역 적용', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: '이후 변경도 자동 동기화', exact: true }).check();
  await dialog.getByRole('button', { name: '선택한 화면에 공통 영역 적용', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '모든 변경 저장됨' })).toBeVisible();
  const reapplied = await getProject(request, original.id);
  expect(reapplied.wireframes[1].elements).toEqual(original.wireframes[1].elements);
  expect(reapplied.wireframes[1].navigationSync).toEqual(original.wireframes[1].navigationSync);
  expect(reapplied.wireframes[2]).toEqual(original.wireframes[2]);
  await page.getByTestId(`screen-${original.wireframes[1].id}`).click();
  await page.getByRole('button', { name: 'Tablet', exact: true }).click();
  await expect.poll(async () => (await getProject(request, original.id)).wireframes[1].device).toBe('tablet');
  const changed = await getProject(request, original.id);
  expect(changed.wireframes[1].navigationSync).toBeUndefined();
  expect(changed.wireframes[1].elements).toEqual(original.wireframes[1].elements);
});

test('NS04: server rejects crafted cross-device binding and propagation beyond 500 nodes atomically', async ({ request }) => {
  let original = await seedNestedProject(request);
  const invalid = linkedHeaders(original); invalid[1].device = 'tablet';
  const save = (value: Project['wireframes']) => request.put(`${API}/projects/${original.id}/artifacts/wireframes`, { headers: mutationHeaders, data: { expectedRevision: original.artifactRevisions.wireframes, flowVersionId: original.selectedFlowVersionId, wireframeVersionId: original.selectedWireframeVersionId, value } });
  const crossDevice = await save(invalid); expect(crossDevice.status()).toBe(400);
  expect(await getProject(request, original.id)).toEqual(original);
  const screens = linkedHeaders(original), header = screens[1].elements[0];
  screens[1].elements = [header, ...Array.from({ length: 5 }, (_, group) => ({ id: `${original.id}-full-group-${group}`, type: 'column' as const, text: '', targetScreenId: null, children: Array.from({ length: 98 }, (_, index) => ({ id: `${original.id}-full-${group}-${index}`, type: 'text' as const, text: `보존할 본문 ${group}-${index}`, targetScreenId: null })) })), ...Array.from({ length: 2 }, (_, index) => ({ id: `${original.id}-last-${index}`, type: 'text' as const, text: '최대 노드 경계', targetScreenId: null }))];
  expect(flattenElements(screens[1].elements)).toHaveLength(500);
  original = await saveArtifact(request, original, 'wireframes', screens);
  const grown = structuredClone(original.wireframes);
  grown[0].elements[0].children!.push({ id: `${original.id}-would-overflow`, type: 'text', text: '동기화 대상 한도 초과', targetScreenId: null });
  const overflow = await save(grown); expect(overflow.status()).toBe(400);
  expect(await getProject(request, original.id)).toEqual(original);
});
