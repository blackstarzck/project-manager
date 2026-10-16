import { expect, test } from '@playwright/test';
import { API, createProject } from '../fixtures.js';

test('UAT-UX-02a: one click on an empty PRD item allows typing and a late save never reclaims focus', async ({ page, request }) => {
  const project = await createProject(request, 'PRD 첫 입력 포커스');
  await page.goto(`/#project/${project.id}/prd`);
  let releaseSave!: () => void;
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  let saveRequested = false;
  await page.route(`**/api/projects/${project.id}/artifacts/prd`, async route => {
    saveRequested = true;
    await gate;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: '제품 한 줄 정의 내용을 작성해 주세요…', exact: true }).click();
    const body = page.getByRole('textbox', { name: '제품 한 줄 정의 내용', exact: true });
    await expect(body).toBeFocused();
    await page.keyboard.insertText('추가 클릭 없이 바로 작성한 도서 예약 서비스입니다.');
    await expect(body).toHaveText('추가 클릭 없이 바로 작성한 도서 예약 서비스입니다.');
    await expect.poll(() => saveRequested).toBe(true);
    const title = page.getByRole('textbox', { name: '개요 항목 제목', exact: true });
    await title.click();
    await expect(title).toBeFocused();
    releaseSave();
    await expect(page.getByText('모든 변경 저장됨', { exact: true })).toBeVisible();
    await expect(title).toBeFocused();
    expect((await (await request.get(`${API}/projects/${project.id}`)).json()).prd[0].content).toContain('추가 클릭 없이 바로 작성한 도서 예약 서비스입니다.');
  } finally {
    releaseSave();
  }
});

test('UAT-UX-02b: keyboard creation focuses each new body once without focusing existing items on tab return or reload', async ({ page, request }) => {
  const project = await createProject(request, 'PRD 키보드 입력 포커스');
  await page.goto(`/#project/${project.id}/prd`);
  const placeholder = page.getByRole('button', { name: '사용자 문제 내용을 작성해 주세요…', exact: true });
  await placeholder.focus();
  await page.keyboard.press('Enter');
  const firstBody = page.getByRole('textbox', { name: '사용자 문제 내용', exact: true });
  await expect(firstBody).toBeFocused();
  await page.keyboard.insertText('방문한 뒤 책이 대출 중임을 알게 된다.');
  const add = page.locator('#section-problem').getByRole('button', { name: '항목 추가', exact: true });
  await add.focus();
  await page.keyboard.press('Space');
  const nextBody = page.getByRole('textbox', { name: '새 항목 내용', exact: true });
  await expect(nextBody).toBeFocused();
  await page.keyboard.insertText('방문 전에 예약 가능 여부를 확인해야 한다.');
  await page.getByRole('tab', { name: '기능명세', exact: true }).click();
  await page.getByRole('tab', { name: 'PRD', exact: true }).click();
  await expect(firstBody).toHaveText('방문한 뒤 책이 대출 중임을 알게 된다.');
  await expect(nextBody).toHaveText('방문 전에 예약 가능 여부를 확인해야 한다.');
  await expect(firstBody).not.toBeFocused();
  await expect(nextBody).not.toBeFocused();
  await page.reload();
  await expect(firstBody).toHaveText('방문한 뒤 책이 대출 중임을 알게 된다.');
  await expect(nextBody).toHaveText('방문 전에 예약 가능 여부를 확인해야 한다.');
  await expect(firstBody).not.toBeFocused();
  await expect(nextBody).not.toBeFocused();
});
