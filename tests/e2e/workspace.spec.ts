import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Project } from '../../shared/schema.js';
import { API, CANCEL_POLICY, createProject, seedProject } from '../fixtures.js';

async function currentProject(request: APIRequestContext, id: string): Promise<Project> {
  return (await request.get(`${API}/projects/${id}`)).json();
}

async function openProject(page: Page, project: Project) {
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('tab', { name: 'PRD', exact: true })).toBeVisible();
}

async function openAiPanel(page: Page) {
  if (!await page.getByRole('textbox', { name: 'AI 요청', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
  }
  await expect(page.getByRole('textbox', { name: 'AI 요청', exact: true })).toBeVisible();
}

test('Q01/Q02: create a project in UI, edit Korean PRD, save and reload', async ({ page, request }) => {
  const name = `도서관 UI 검수 ${randomUUID().slice(0, 8)}`;
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '새 프로젝트', exact: true }).click();
  await page.getByRole('textbox', { name: '프로젝트 이름', exact: true }).fill(name);
  await page.getByRole('textbox', { name: '프로젝트 설명', exact: true }).fill('회원과 사서를 위한 도서 예약 서비스');
  await page.getByRole('dialog', { name: '새 프로젝트 만들기' }).getByRole('button', { name: '프로젝트 만들기', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'PRD', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '항목 추가', exact: true }).first().click();
  await page.getByRole('textbox', { name: '제품 한 줄 정의 내용', exact: true }).fill(CANCEL_POLICY);
  const projectId = page.url().split('#project/')[1]?.split('/')[0];
  expect(projectId).toBeTruthy();
  await expect.poll(async () => (await currentProject(request, projectId)).prd[0]?.content).toContain(CANCEL_POLICY);
  await expect(page.getByRole('status')).toContainText('모든 변경 저장됨');
  await page.reload();
  await expect(page.getByRole('textbox', { name: '제품 한 줄 정의 내용', exact: true })).toContainText(CANCEL_POLICY);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: 'tests/artifacts/workspace-prd.png', fullPage: true });
});

test('Q03: three feature views show the same edited entity and hierarchy', async ({ page, request }) => {
  const project = await seedProject(request);
  await openProject(page, project);
  await page.getByRole('tab', { name: '기능명세', exact: true }).click();
  await page.getByRole('button', { name: '디렉토리 뷰', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '기능 제목', exact: true })).toHaveValue('도서 예약');
  await page.getByRole('textbox', { name: '기능 제목', exact: true }).fill('도서 예약 관리');
  await page.getByRole('textbox', { name: '기능 설명', exact: true }).fill('회원이 도서를 예약하고 취소할 수 있습니다.');
  await expect.poll(async () => (await currentProject(request, project.id)).features[0]?.title).toBe('도서 예약 관리');
  await page.getByRole('button', { name: /^(트리|그래프) 뷰$/ }).click();
  await expect(page.getByText('도서 예약 관리', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('도서 검색', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'tests/artifacts/workspace-features-tree.png', fullPage: true });
  await page.getByRole('button', { name: /^(문서|도큐먼트) 뷰$/ }).click();
  await expect(page.getByRole('textbox', { name: '기능 제목', exact: true }).nth(0)).toHaveValue('도서 예약 관리');
  await expect(page.getByRole('textbox', { name: '기능 제목', exact: true }).nth(2)).toHaveValue('제목 검색');
  await page.getByRole('button', { name: '디렉토리 뷰', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '기능 설명', exact: true })).toHaveValue('회원이 도서를 예약하고 취소할 수 있습니다.');
  await page.reload();
  await page.getByRole('tab', { name: '기능명세', exact: true }).click();
  await page.getByRole('button', { name: '디렉토리 뷰', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '기능 제목', exact: true })).toHaveValue('도서 예약 관리');
  const saved = await currentProject(request, project.id);
  expect(saved.features.map(f => f.id)).toEqual(project.features.map(f => f.id));
  expect(saved.features[2].parentId).toBe(saved.features[1].id);
});

test('Q06: two browser tabs never silently overwrite each other', async ({ page, context, request }) => {
  const project = await seedProject(request);
  const second = await context.newPage();
  await openProject(page, project);
  await openProject(second, project);
  await page.getByRole('textbox', { name: '서비스 소개 내용', exact: true }).fill('첫 번째 탭에서 먼저 저장한 내용');
  await expect.poll(async () => (await currentProject(request, project.id)).prd[0]?.content).toContain('첫 번째 탭에서 먼저 저장한 내용');
  await second.getByRole('textbox', { name: '서비스 소개 내용', exact: true }).fill('두 번째 탭의 충돌하는 수정');
  await expect(second.getByRole('status')).toContainText('저장 실패');
  await expect(second.getByRole('alert')).toContainText('최신');
  expect((await currentProject(request, project.id)).prd[0].content).toContain('첫 번째 탭에서 먼저 저장한 내용');
  await expect(second.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toContainText('두 번째 탭의 충돌하는 수정');
  await second.close();
});

test('Q02: switching tabs immediately after typing flushes the latest unsaved document', async ({ page, request }) => {
  const project = await seedProject(request);
  await openProject(page, project);
  const text = '저장 대기 중 탭을 바꿔도 이 마지막 편집은 보존되어야 합니다.';
  await page.getByRole('textbox', { name: '서비스 소개 내용', exact: true }).fill(text);
  await page.getByRole('tab', { name: '기능명세', exact: true }).click();
  await expect(page.getByRole('tab', { name: '기능명세', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect((await currentProject(request, project.id)).prd[0].content).toContain(text);
  await page.getByRole('tab', { name: 'PRD', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toContainText(text);
});

test('Q09/Q13: flow node edits save; deleting a page used by a screen is guarded', async ({ page, request }) => {
  const project = await seedProject(request);
  await openProject(page, project);
  await page.getByRole('tab', { name: '유저플로우', exact: true }).click();
  await page.locator('.react-flow__node').filter({ hasText: '도서 검색' }).click();
  await page.getByRole('textbox', { name: '노드 이름', exact: true }).fill('도서 통합 검색');
  await expect.poll(async () => (await currentProject(request, project.id)).flow.nodes[1]?.label).toBe('도서 통합 검색');
  const beforeLayout = await currentProject(request, project.id);
  await page.getByRole('button', { name: '정리', exact: true }).click();
  await expect.poll(async () => (await currentProject(request, project.id)).artifactRevisions.flow).toBeGreaterThan(beforeLayout.artifactRevisions.flow);
  const afterLayout = await currentProject(request, project.id);
  expect(afterLayout.flow.nodes.map(node => node.position)).not.toEqual(beforeLayout.flow.nodes.map(node => node.position));
  expect(afterLayout.flow.nodes.map(node => node.label)).toEqual(beforeLayout.flow.nodes.map(node => node.label));
  await page.getByRole('button', { name: '노드 삭제', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('와이어프레임');
  expect((await currentProject(request, project.id)).flow.nodes).toHaveLength(3);
  await page.screenshot({ path: 'tests/artifacts/workspace-flow.png', fullPage: true });
});

test('Q04/Q10/Q20: real browser completes AI proposal flow from PRD to clickable screens', async ({ page, request }) => {
  const project = await createProject(request);
  await openProject(page, project);
  await openAiPanel(page);
  for (const [tab, artifact] of [['PRD', 'prd'], ['기능명세', 'features'], ['유저플로우', 'flow'], ['와이어프레임', 'wireframes']] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const before = await currentProject(request, project.id);
    await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill(`도서관 ${tab}를 작성해 주세요.`);
    await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
    await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
    expect((await currentProject(request, project.id))[artifact]).toEqual(before[artifact]);
    await expect(page.getByRole('dialog')).toContainText('현재 내용');
    await expect(page.getByRole('dialog')).toContainText('변경 후');
    await page.getByRole('button', { name: '선택 승인', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await currentProject(request, project.id)).artifactRevisions[artifact]).toBeGreaterThan(before.artifactRevisions[artifact]);
  }
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByTestId('wireframe-preview').getByRole('button', { name: '도서 상세 보기', exact: true }).click();
  await expect(page.getByTestId('wireframe-preview').getByRole('heading', { name: '도서 상세', exact: true })).toBeVisible();
  await page.screenshot({ path: 'tests/artifacts/workspace-complete-flow.png', fullPage: true });
});

test('Q10/Q11/Q15: screen edit mode preserves navigation, saves Korean text, and exports a real PNG', async ({ page, request }) => {
  const project = await seedProject(request);
  await openProject(page, project);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  const first = project.wireframes[0];
  await page.getByTestId(`wire-element-${first.elements[2].id}`).click();
  await expect(page.getByTestId('wireframe-preview').getByRole('heading', { name: '도서 검색', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('예약할 도서 확인하기');
  await expect.poll(async () => (await currentProject(request, project.id)).wireframes[0].elements[2].text).toBe('예약할 도서 확인하기');
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await page.getByTestId('wireframe-preview').getByRole('button', { name: '예약할 도서 확인하기', exact: true }).click();
  await expect(page.getByTestId('wireframe-preview').getByRole('heading', { name: '도서 상세', exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const localFile = await download.path();
  expect(localFile).toBeTruthy();
  const png = await readFile(localFile!);
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.length).toBeGreaterThan(1000);
  await page.screenshot({ path: 'tests/artifacts/workspace-wireframe.png', fullPage: true });
  await page.reload();
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await expect(page.getByTestId(`wire-element-${first.elements[2].id}`)).toContainText('예약할 도서 확인하기');
});

test('Q11: undo on one screen preserves edits on a different screen', async ({ page, request }) => {
  const project = await seedProject(request);
  await openProject(page, project);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  const first = project.wireframes[0], second = project.wireframes[1];
  await page.getByTestId(`wire-element-${first.elements[0].id}`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('첫 화면 수정 제목');
  await expect.poll(async () => (await currentProject(request, project.id)).wireframes[0].elements[0].text).toBe('첫 화면 수정 제목');
  await page.getByTestId(`screen-${second.id}`).click();
  await page.getByTestId(`wire-element-${second.elements[0].id}`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('두 번째 화면 보존 제목');
  await expect.poll(async () => (await currentProject(request, project.id)).wireframes[1].elements[0].text).toBe('두 번째 화면 보존 제목');
  await page.getByTestId(`screen-${first.id}`).click();
  await page.getByRole('button', { name: '화면 편집 실행 취소', exact: true }).click();
  await expect.poll(async () => (await currentProject(request, project.id)).wireframes[0].elements[0].text).toBe(first.elements[0].text);
  expect((await currentProject(request, project.id)).wireframes[1].elements[0].text).toBe('두 번째 화면 보존 제목');
});

test('Q07: AI cancellation is available in the browser and late draft never applies', async ({ page, request }) => {
  const project = await seedProject(request);
  await openProject(page, project);
  await openAiPanel(page);
  await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill('[QA_DELAY] 이 요청을 취소합니다.');
  await page.getByRole('button', { name: 'AI 생성 요청', exact: true }).click();
  await page.getByRole('button', { name: '생성 취소', exact: true }).click();
  await expect(page.getByText('생성이 취소됐어요', { exact: true })).toBeVisible();
  await new Promise(resolve => setTimeout(resolve, 1900));
  expect((await currentProject(request, project.id)).prd).toEqual(project.prd);
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toHaveCount(0);
});

test('Q07/Q12: retrying cancelled single-screen generation keeps the original selection scope', async ({ page, request }) => {
  const project = await seedProject(request);
  await openProject(page, project);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByRole('button', { name: '이 화면 AI 개선', exact: true }).click();
  await page.getByRole('button', { name: '생성 취소', exact: true }).click();
  await expect(page.getByText('생성이 취소됐어요', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  await page.getByRole('button', { name: '선택 승인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const updated = await currentProject(request, project.id);
  expect(updated.wireframes[0].elements[0].text).toBe('AI가 수정한 화면 제목');
  expect(updated.wireframes[1]).toEqual(project.wireframes[1]);
});

test('Q19: disconnected AI is explicit while manual document editing remains available', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.route('**/api/ai/status', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ provider: 'groq', configured: false, model: 'qa-unconfigured', models: ['qa-unconfigured'] }) }));
  await openProject(page, project);
  await openAiPanel(page);
  await expect(page.getByText(/Groq API 키 설정이 필요해요/)).toBeVisible();
  await page.getByRole('textbox', { name: 'AI 요청', exact: true }).fill('생성을 요청합니다.');
  await expect(page.getByRole('button', { name: 'AI 생성 요청', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: '서비스 소개 내용', exact: true }).fill('AI 연결 없이도 직접 작성한 기획');
  await expect.poll(async () => (await currentProject(request, project.id)).prd[0].content).toContain('AI 연결 없이도 직접 작성한 기획');
});
