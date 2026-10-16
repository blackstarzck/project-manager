import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Project } from '../../shared/schema.js';
import { API, seedProject } from '../fixtures.js';

test('Q06/Q12: conflicted selected-screen proposal offers explicit scoped regeneration without overwriting manual edits', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  const first = project.wireframes[0];
  const firstRequest = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith(`/api/projects/${project.id}/ai/runs`));
  await page.getByRole('button', { name: '이 화면 AI 개선', exact: true }).click();
  const originalRequest = (await firstRequest).postDataJSON();
  expect(originalRequest.entityIds).toEqual([first.id]);
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  await page.getByTestId(`wire-element-${first.elements[0].id}`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('생성 이후 사용자가 확정한 수동 제목');
  const current = async (): Promise<Project> => (await request.get(`${API}/projects/${project.id}`)).json();
  await expect.poll(async () => (await current()).wireframes[0].elements[0].text).toBe('생성 이후 사용자가 확정한 수동 제목');
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  const conflictResponse = page.waitForResponse(res => res.request().method() === 'POST' && res.url().includes('/api/proposals/') && res.url().endsWith('/resolve'));
  await page.getByRole('button', { name: '선택 승인', exact: true }).click();
  expect((await conflictResponse).status()).toBe(409);
  await expect(page.getByRole('dialog').getByRole('button', { name: '현재 문서로 다시 생성', exact: true })).toBeVisible();
  expect((await current()).wireframes[0].elements[0].text).toBe('생성 이후 사용자가 확정한 수동 제목');
  const nextRequest = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith(`/api/projects/${project.id}/ai/runs`));
  await page.getByRole('dialog').getByRole('button', { name: '현재 문서로 다시 생성', exact: true }).click();
  const regeneratedRequest = (await nextRequest).postDataJSON();
  expect(regeneratedRequest.artifact).toBe(originalRequest.artifact);
  expect(regeneratedRequest.prompt).toBe(originalRequest.prompt);
  expect(regeneratedRequest.entityIds).toEqual(originalRequest.entityIds);
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  const beforeApproval = await current();
  expect(beforeApproval.wireframes[0].elements[0].text).toBe('생성 이후 사용자가 확정한 수동 제목');
  expect(beforeApproval.wireframes[1]).toEqual(project.wireframes[1]);
  await page.getByRole('button', { name: '선택 승인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const afterApproval = await current();
  expect(afterApproval.wireframes[0].elements[0].text).toBe('AI가 수정한 화면 제목');
  expect(afterApproval.wireframes[1]).toEqual(project.wireframes[1]);
});

test('Q15: the workspace export dialog downloads valid PNGs of PRD and feature documents', async ({ page, request }) => {
  const project = await seedProject(request);
  await page.goto(`/#project/${project.id}`);
  await expect(page.getByRole('textbox', { name: '서비스 소개 내용', exact: true })).toBeVisible();
  for (const artifact of ['prd', 'features'] as const) {
    if (artifact === 'features') {
      await page.getByRole('tab', { name: '기능명세', exact: true }).click();
      await page.getByRole('button', { name: '도큐먼트 뷰', exact: true }).click();
    }
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('dialog', { name: '내보내기 및 백업' }).getByRole('button', { name: /PNG 이미지/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(new RegExp(`-${artifact}\\.png$`));
    const localFile = await download.path();
    expect(localFile).toBeTruthy();
    const png = await readFile(localFile!);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.length).toBeGreaterThan(1000);
    expect(png.readUInt32BE(16)).toBeGreaterThan(500);
    expect(png.readUInt32BE(20)).toBeGreaterThan(500);
    await download.saveAs(`tests/artifacts/focused-export-${artifact}.png`);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('dialog', { name: '내보내기 및 백업' }).getByRole('button', { name: '닫기', exact: true }).click();
  }
});
