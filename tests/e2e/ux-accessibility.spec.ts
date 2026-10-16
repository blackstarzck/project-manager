import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import type { Project } from '../../shared/schema.js';
import { API, mutationHeaders, seedProject } from '../fixtures.js';

const fixedDate = '2026-10-16T03:00:00.000Z';
const viewports = [{ width: 970, height: 760 }, { width: 1280, height: 800 }, { width: 1440, height: 1000 }];

async function visualProject(request: APIRequestContext, page: Page): Promise<Project> {
  const original = await seedProject(request);
  const response = await request.patch(`${API}/projects/${original.id}`, { headers: mutationHeaders, data: { expectedRevision: original.revision, name: '동네 도서관 예약 서비스', description: '회원과 사서가 도서를 찾고 예약하며 수령 일정을 관리하는 서비스' } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const project = await response.json() as Project;
  // Only timestamps are normalized for reproducible screenshots. Document content and styles remain intact.
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const upstream = await route.fetch();
    const value = await upstream.json() as Project;
    value.createdAt = fixedDate; value.updatedAt = fixedDate;
    value.flowGroups.forEach(group => {
      group.createdAt = fixedDate;
      group.versions.forEach(version => {
        version.createdAt = fixedDate; version.updatedAt = fixedDate;
        version.wireframeVersions.forEach(screenVersion => { screenVersion.createdAt = fixedDate; screenVersion.updatedAt = fixedDate; });
      });
    });
    await route.fulfill({ response: upstream, json: value });
  });
  return project;
}

async function auditScreen(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(await page.evaluate(() => document.fonts.check('14px "Pretendard Variable"'))).toBe(true);
  await page.mouse.move(0, 0);
  const result = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`${name}-axe`, { contentType: 'application/json', body: JSON.stringify({ url: page.url(), viewport: page.viewportSize(), violations: result.violations, incomplete: result.incomplete }, null, 2) });
  const violations = result.violations.map(violation => ({ id: violation.id, impact: violation.impact, description: violation.description, nodes: violation.nodes.map(node => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })) }));
  expect.soft(violations, `${name}: accessibility violations; no selectors or rules are excluded`).toEqual([]);
  expect.soft(result.incomplete.filter(item => item.id === 'aria-prohibited-attr'), `${name}: labeled groups must have supported semantics`).toEqual([]);
  // SVG overlap prevents axe from resolving label contrast. Check the actual rendered fills directly.
  const edgeContrasts = await page.locator('.react-flow__edge-text').evaluateAll(elements => {
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!rgb || rgb.length !== 3) throw new Error(`Unsupported computed SVG fill: ${color}`);
      return rgb.reduce((sum, value, index) => {
        const channel = value / 255;
        return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
      }, 0);
    };
    return elements.map(element => {
      const background = element.parentElement?.querySelector('.react-flow__edge-textbg');
      if (!background) throw new Error('Expected the SVG edge label background');
      const foregroundFill = getComputedStyle(element).fill;
      const backgroundFill = getComputedStyle(background).fill;
      const foregroundLuminance = luminance(foregroundFill), backgroundLuminance = luminance(backgroundFill);
      return { text: element.textContent, foregroundFill, backgroundFill, contrast: (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05) };
    });
  });
  for (const edge of edgeContrasts) expect.soft(edge.contrast, `${name}: edge label '${edge.text}' contrast`).toBeGreaterThanOrEqual(4.5);
  // Capture the stable entry state before keyboard checks intentionally change focus-visible state.
  const observedPath = testInfo.outputPath(`${name}-observed.png`);
  await page.screenshot({ path: observedPath, animations: 'disabled', caret: 'hide', fullPage: false });
  await testInfo.attach(`${name}-observed`, { path: observedPath, contentType: 'image/png' });
  await expect.soft(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', fullPage: false, maxDiffPixels: 50 });
  const dialog = page.getByRole('dialog');
  let focusSteps = 0;
  if (await dialog.count()) {
    const originalFocus = await page.locator(':focus').elementHandle();
    focusSteps = await dialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])').evaluateAll(elements => elements.filter(element => element.getClientRects().length).length + 1);
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let step = 0; step < focusSteps; step++) {
        await page.keyboard.press(key);
        expect.soft(await dialog.evaluate(element => element.contains(document.activeElement)), `${name}: ${key} focus stays inside the dialog`).toBe(true);
      }
    }
    await originalFocus?.evaluate(element => (element as HTMLElement).focus());
  }
  await testInfo.attach(`${name}-manual-checks`, { contentType: 'application/json', body: JSON.stringify({ edgeContrasts, dialogFocusStepsEachDirection: focusSteps }, null, 2) });
}

async function checkGraphControls(page: Page, label: string) {
  const controls = page.getByRole('group', { name: label, exact: true });
  await expect(controls).toBeVisible();
  await expect(controls.getByRole('button')).toHaveCount(3);
  const scale = () => page.locator('.react-flow__viewport').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a);
  const initialScale = await scale();
  await controls.locator('.react-flow__controls-zoomin').click();
  await expect.poll(scale).toBeGreaterThan(initialScale);
  const enlargedScale = await scale();
  await controls.locator('.react-flow__controls-zoomout').click();
  await expect.poll(scale).toBeLessThan(enlargedScale);
  await controls.locator('.react-flow__controls-fitview').click();
  await expect.poll(() => page.locator('.react-flow__node').evaluateAll(nodes => nodes.every(node => {
    const canvas = node.closest('.react-flow')!.getBoundingClientRect(), bounds = node.getBoundingClientRect();
    return bounds.left >= canvas.left && bounds.top >= canvas.top && bounds.right <= canvas.right && bounds.bottom <= canvas.bottom;
  }))).toBe(true);
}

for (const viewport of viewports) {
  test(`UX-A11Y-${viewport.width}: document and canvas accessibility with stable visual baselines`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const project = await visualProject(request, page);
    const suffix = `${viewport.width}x${viewport.height}`;
    await page.goto(`/#project/${project.id}/prd`);
    await expect(page.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toBeVisible();
    await auditScreen(page, testInfo, `prd-${suffix}`);

    await page.getByRole('tab', { name: '기능명세', exact: true }).click();
    await expect(page.locator('.feature-graph-node')).toHaveCount(4);
    await auditScreen(page, testInfo, `features-graph-${suffix}`);
    if (viewport.width === 1440) await checkGraphControls(page, '기능 그래프 보기 도구');
    await page.getByRole('button', { name: '디렉토리 뷰', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '기능 제목', exact: true })).toBeVisible();
    await auditScreen(page, testInfo, `features-directory-${suffix}`);
    await page.getByRole('button', { name: '도큐먼트 뷰', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '기능 제목', exact: true })).toHaveCount(3);
    await auditScreen(page, testInfo, `features-document-${suffix}`);

    await page.getByRole('tab', { name: '유저플로우', exact: true }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await auditScreen(page, testInfo, `flow-${suffix}`);
    if (viewport.width === 1440) await checkGraphControls(page, '플로우 보기 도구');
    await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
    await expect(page.getByRole('button', { name: '이 화면 AI 개선', exact: true })).toBeVisible();
    await auditScreen(page, testInfo, `wireframe-${suffix}`);
  });
}

test('UX-A11Y-dialogs: dashboard, creation, settings, export and fixture-generated proposal review are accessible', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const project = await visualProject(request, page);
  await page.route('**/api/projects', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const upstream = await route.fetch();
    const values = await upstream.json() as { id: string; createdAt: string; updatedAt: string }[];
    await route.fulfill({ response: upstream, json: values.filter(value => value.id === project.id).map(value => ({ ...value, createdAt: fixedDate, updatedAt: fixedDate })) });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: `${project.name} 프로젝트 열기`, exact: true })).toBeVisible();
  await auditScreen(page, testInfo, 'dashboard-1440x1000');
  await page.getByRole('button', { name: '새 프로젝트', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '새 프로젝트 만들기', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill('긴 한글 프로젝트 제목도 잘 읽히는 공동 도서 예약 서비스');
  await auditScreen(page, testInfo, 'project-create-1440x1000');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `${project.name} 프로젝트 열기`, exact: true }).click();
  await expect(page.getByRole('tab', { name: 'PRD', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '프로젝트 설정', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '프로젝트 설정', exact: true })).toBeVisible();
  await auditScreen(page, testInfo, 'project-settings-1440x1000');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '내보내기 및 백업', exact: true })).toBeVisible();
  await auditScreen(page, testInfo, 'export-1440x1000');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'AI 패널 펼치기', exact: true }).click();
  await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill('현재 서비스 소개를 더 명확하게 정리해 주세요.');
  await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI 변경 제안 검토', exact: true })).toBeVisible();
  await auditScreen(page, testInfo, 'ai-review-1440x1000');
  expect((await (await request.get(`${API}/projects/${project.id}`)).json()).prd).toEqual(project.prd);
});
