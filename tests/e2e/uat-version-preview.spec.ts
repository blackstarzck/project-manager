import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Project, Revision } from '../../shared/schema.js';
import { API, createProject, saveArtifact, seedProject } from '../fixtures.js';

const dialogName = '프로젝트 버전 기록';
const history = (page: Page) => page.getByRole('dialog', { name: dialogName, exact: true });
const previewButton = (page: Page, version: number) => history(page).getByRole('button', { name: `버전 ${version} 내용 미리보기`, exact: true });
const previewRegion = (page: Page, version: number) => history(page).getByRole('region', { name: `버전 ${version} 내용`, exact: true });

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/(?:projects\/[^/]+\/ai\/runs|ai\/runs)/, async route => {
    throw new Error(`Version preview must not invoke AI: ${route.request().method()} ${route.request().url()}`);
  });
});

test('UAT-VP01: preview is read-only, identifies saved contents and restores the exact previewed revision with history retained', async ({ page, request }) => {
  const before = await seedProject(request);
  const changed = await saveArtifact(request, before, 'prd', [{ ...before.prd[0], title: '예약 정책 변경 후', content: '<p>당일 취소는 허용하지 않습니다.</p>' }]);
  const revisions = await (await request.get(`${API}/projects/${before.id}/revisions`)).json() as Revision[];
  const saved = revisions.find(revision => revision.revision === before.revision)!;
  await page.goto(`/#project/${before.id}/prd`);
  await page.getByRole('button', { name: '버전 기록', exact: true }).click();
  await expect(history(page).getByRole('article', { name: `버전 ${changed.revision} 현재 버전`, exact: true })).toContainText('현재 버전');
  await expect(history(page).getByRole('button', { name: `버전 ${changed.revision} 복원`, exact: true })).toBeDisabled();
  let previewMutations = 0;
  page.on('request', req => { if (req.url().includes('/api/') && req.method() !== 'GET') previewMutations++; });
  await previewButton(page, before.revision).click();
  const preview = previewRegion(page, before.revision);
  await expect(preview).toContainText('PRD 1개 · 기능명세 3개 · 플로우 3개 노드 · 화면 2개');
  await expect(preview.getByRole('heading', { name: '서비스 소개', exact: true })).toBeVisible();
  await expect(preview).toContainText('도서관 회원을 위한 도서 검색 및 예약 서비스입니다.');
  await expect(preview).not.toContainText('당일 취소는 허용하지 않습니다.');
  await expect(preview.getByRole('region', { name: '와이어프레임 미리보기', exact: true })).toContainText('도서 상세');
  expect(await (await request.get(`${API}/projects/${before.id}`)).json()).toEqual(changed);
  expect(await (await request.get(`${API}/projects/${before.id}/revisions`)).json()).toEqual(revisions);
  expect(previewMutations).toBe(0);
  const restoring = page.waitForRequest(req => req.url().endsWith(`/revisions/${saved.id}/restore`) && req.method() === 'POST');
  page.once('dialog', confirmation => { expect(confirmation.message()).toContain('전체 문서와 프로젝트 설정'); void confirmation.accept(); });
  await history(page).getByRole('button', { name: `버전 ${before.revision} 복원`, exact: true }).click();
  await restoring;
  await expect(history(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toContainText('도서관 회원을 위한 도서 검색 및 예약 서비스입니다.');
  const restored = await (await request.get(`${API}/projects/${before.id}`)).json() as Project;
  expect(restored.revision).toBe(changed.revision + 1);
  expect(restored.prd.map(item => ({ title: item.title, content: item.content }))).toEqual(before.prd.map(item => ({ title: item.title, content: item.content })));
  expect(restored.features.map(item => item.title)).toEqual(before.features.map(item => item.title));
  expect(restored.flow).toEqual(before.flow);
  expect(restored.wireframes.map(screen => screen.name)).toEqual(before.wireframes.map(screen => screen.name));
  const after = await (await request.get(`${API}/projects/${before.id}/revisions`)).json() as Revision[];
  expect(after).toHaveLength(revisions.length + 1);
  expect(after.slice(1)).toEqual(revisions);
  expect(after[0].label).toBe(`버전 ${before.revision} 복원`);
});

test('UAT-VP02: preview errors retry safely, render inert plain text and support Enter, Space, Escape and focus return', async ({ page, request }) => {
  const project = await seedProject(request);
  const rows = await (await request.get(`${API}/projects/${project.id}/revisions`)).json() as Revision[];
  const row = rows[0];
  let attempts = 0, externalRequests = 0;
  await page.route('https://preview-must-not-load.invalid/**', route => { externalRequests++; return route.abort(); });
  await page.route(`**/api/projects/${project.id}/revisions/${row.id}`, route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: '미리보기를 불러오지 못했습니다. 다시 시도해 주세요.' } });
    return route.fulfill({ json: { ...project, prd: [{ ...project.prd[0], content: '<p>예약 &amp; 수령 안내</p><p>둘째 문단<br>다음 줄</p><script>window.previewExecuted = true</script><img src="https://preview-must-not-load.invalid/image.png" onerror="window.previewExecuted = true">' }] } });
  });
  await page.goto(`/#project/${project.id}/prd`);
  const opener = page.getByRole('button', { name: '버전 기록', exact: true });
  await opener.click();
  const toggle = previewButton(page, project.revision);
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(previewRegion(page, project.revision).getByRole('alert')).toContainText('다시 시도');
  await previewRegion(page, project.revision).getByRole('button', { name: '미리보기 다시 불러오기', exact: true }).click();
  await expect(previewRegion(page, project.revision)).toContainText('예약 & 수령 안내');
  expect(await previewRegion(page, project.revision).locator('.version-preview-prd p').innerText()).toContain('둘째 문단\n다음 줄');
  await expect(previewRegion(page, project.revision).locator('script,img,iframe')).toHaveCount(0);
  expect(await page.evaluate(() => 'previewExecuted' in window)).toBe(false);
  expect(externalRequests).toBe(0);
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(attempts).toBe(2);
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let step = 0; step < 16; step++) {
      await page.keyboard.press(key);
      expect(await history(page).evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
  }
  await page.keyboard.press('Escape');
  await expect(history(page)).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect((await (await request.get(`${API}/projects/${project.id}`)).json()).revision).toBe(project.revision);
});

test('UAT-VP03: late preview responses do not reopen a collapsed version or leak into another project', async ({ page, request }) => {
  const original = await seedProject(request), next = await createProject(request, '다른 프로젝트의 기록');
  const rows = await (await request.get(`${API}/projects/${original.id}/revisions`)).json() as Revision[];
  let requested = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${original.id}/revisions/${rows[0].id}`, async route => {
    requested = true; await gate;
    await route.fulfill({ json: { ...original, name: '늦게 도착한 이전 프로젝트 미리보기' } });
  });
  await page.goto(`/#project/${original.id}/prd`);
  await page.getByRole('button', { name: '버전 기록', exact: true }).click();
  await previewButton(page, original.revision).click();
  await expect.poll(() => requested).toBe(true);
  await previewButton(page, original.revision).click();
  await expect(previewButton(page, original.revision)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await page.evaluate(id => { location.hash = `project/${id}/prd`; }, next.id);
  await expect(page.locator('.breadcrumbs strong')).toHaveText(next.name);
  await page.getByRole('button', { name: '버전 기록', exact: true }).click();
  await previewButton(page, next.revision).click();
  await expect(previewRegion(page, next.revision)).toContainText(`프로젝트: ${next.name}`);
  const response = page.waitForResponse(result => result.url().endsWith(`/revisions/${rows[0].id}`));
  release(); await (await response).finished();
  await expect(history(page)).not.toContainText('늦게 도착한 이전 프로젝트 미리보기');
  await expect(previewRegion(page, next.revision)).toContainText('작성된 PRD가 없어요.');
});

for (const viewport of [{ width: 970, height: 760 }, { width: 720, height: 500 }]) {
  test(`UAT-VP04-${viewport.width}: long preview stays readable and modal actions remain reachable`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    let project = await seedProject(request);
    project = await saveArtifact(request, project, 'prd', [{ ...project.prd[0], title: '한글로 길게 작성한 서비스 소개와 도서 예약 정책', content: Array.from({ length: 55 }, (_, index) => `<p>${index + 1}. 회원은 도서를 검색하고 예약 가능 여부와 수령 일정을 확인합니다.</p>`).join('') }]);
    await page.goto(`/#project/${project.id}/prd`);
    await page.getByRole('button', { name: '버전 기록', exact: true }).click();
    await previewButton(page, project.revision).click();
    await expect(previewRegion(page, project.revision)).toContainText('55. 회원은 도서를 검색하고');
    const close = history(page).getByRole('button', { name: '기록 닫기', exact: true });
    const bounds = await close.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(await history(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await history(page).locator('.modal-body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter(violation => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([]);
    await testInfo.attach(`version-preview-${viewport.width}-axe`, { contentType: 'application/json', body: JSON.stringify({ violations: axe.violations, incomplete: axe.incomplete }) });
    await testInfo.attach(`version-preview-${viewport.width}`, { contentType: 'image/png', body: await page.screenshot() });
    await close.focus();
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(history(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '버전 기록', exact: true })).toBeFocused();
  });
}
