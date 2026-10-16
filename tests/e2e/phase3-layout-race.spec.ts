import { expect, test, type Page } from '@playwright/test';
import { addFlowVersion, getProject, seedNestedProject, selectFlowVersion } from '../phase2-fixtures.js';

/** Delay the layout dependency only. UI, save API, SQLite and version switching remain real. */
async function deferLayout(page: Page) {
  await page.route(/\/node_modules\/\.vite\/deps\/elkjs[^/]*\.js(?:\?.*)?$/, route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: `
      window.__qaLayouts = [];
      export default class ELK {
        layout(graph) {
          return new Promise(resolve => window.__qaLayouts.push({ release: () => resolve({
            ...graph, children: graph.children.map((node, index) => ({ ...node, x: index * 230, y: 90 }))
          }) }));
        }
      }
    `,
  }));
}
async function waitForLayout(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __qaLayouts?: unknown[] }).__qaLayouts?.length ?? 0)).toBe(1);
}
async function releaseLayout(page: Page) {
  await page.evaluate(() => (window as unknown as { __qaLayouts: { release: () => void }[] }).__qaLayouts[0].release());
}

test('L01: delayed layout from an unmounted flow editor never overwrites the newly selected version', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  let project = await addFlowVersion(request, original, { name: '비어 있는 독립 버전' });
  const otherId = project.selectedFlowVersionId!;
  project = await selectFlowVersion(request, project, original.selectedFlowVersionId!);
  await deferLayout(page);
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '유저플로우', exact: true }).click();
  await page.getByRole('button', { name: '정리', exact: true }).click();
  await waitForLayout(page);
  await page.getByRole('button', { name: '기본 플로우 / 비어 있는 독립 버전 선택', exact: true }).click();
  await expect.poll(async () => (await getProject(request, project.id)).selectedFlowVersionId).toBe(otherId);
  const beforeRelease = await getProject(request, project.id);
  await releaseLayout(page);
  // Let any incorrect 700ms autosave complete after the explicitly released dependency.
  await page.waitForTimeout(1100);
  expect(await getProject(request, project.id)).toEqual(beforeRelease);
  await expect(page.getByText('사용자의 여정을 그려 보세요', { exact: true })).toBeVisible();
});

test('L02: delayed layout never reverts a newer node edit within the same version', async ({ page, request }) => {
  const project = await seedNestedProject(request);
  await deferLayout(page);
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '유저플로우', exact: true }).click();
  await page.getByRole('button', { name: '정리', exact: true }).click();
  await waitForLayout(page);
  await page.locator('.react-flow__node').filter({ hasText: '도서 검색' }).click();
  const name = page.getByRole('textbox', { name: '노드 이름', exact: true });
  await name.fill('정리 중에 입력한 최신 이름');
  await expect.poll(async () => (await getProject(request, project.id)).flow.nodes[1].label).toBe('정리 중에 입력한 최신 이름');
  const beforeRelease = await getProject(request, project.id);
  await releaseLayout(page);
  await expect(page.getByRole('button', { name: '정리', exact: true })).toBeEnabled();
  await expect(name).toHaveValue('정리 중에 입력한 최신 이름');
  await page.waitForTimeout(1100);
  expect(await getProject(request, project.id)).toEqual(beforeRelease);
});
