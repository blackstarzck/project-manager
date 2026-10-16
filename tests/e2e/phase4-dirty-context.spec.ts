import { expect, test } from '@playwright/test';
import { flattenElements, getProject, seedNestedProject } from '../phase2-fixtures.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { activeFlow, addWireVersion, awaitRun, wirePath, wireRun } from '../phase4-fixtures.js';

test('WC01: a context refresh after failed approval never reattributes an unsaved screen draft to another version', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const run = await awaitRun(request, await wireRun(request, original, 'edit', '원본 화면 제목 검토', [original.wireframes[0].id]));
  expect(run.proposalId).toBeTruthy();
  await page.goto(`/#project/${original.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
  await expect(page.getByRole('button', { name: '변경 제안 검토', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'AI 패널 닫기', exact: true }).click();
  // A second client changes server selection while the first client still edits its source.
  const fork = await addWireVersion(request, original, true, '다른 클라이언트가 선택한 사본');
  await page.getByTestId(`layer-${original.id}-nested-nested-title`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('원본에만 속해야 할 미저장 초안');
  await page.getByRole('button', { name: 'AI 도우미 열기', exact: true }).click();
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  await page.getByRole('button', { name: '선택 승인', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'AI 변경 제안 검토', exact: true });
  await expect(review.getByRole('alert')).toContainText('선택한 와이어프레임 버전이 바뀌었습니다');
  // Radix correctly removes background controls from the accessible tree while modal.
  await review.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장 재시도', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
  await page.waitForTimeout(1000);
  expect(await getProject(request, original.id)).toEqual(fork);
  await expect(page.getByRole('combobox', { name: '와이어프레임 버전 선택', exact: true })).toHaveValue(original.selectedWireframeVersionId!);
  await expect(page.getByRole('textbox', { name: '요소 내용', exact: true })).toHaveValue('원본에만 속해야 할 미저장 초안');
  const saved = await getProject(request, original.id);
  expect(flattenElements(saved.wireframes[0].elements).some(element => element.text === '원본에만 속해야 할 미저장 초안')).toBeFalsy();
  await page.getByRole('button', { name: '편집하던 버전으로 돌아가 저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '모든 변경 저장됨' })).toBeVisible();
  const recovered = await getProject(request, original.id);
  expect(recovered.selectedWireframeVersionId).toBe(original.selectedWireframeVersionId);
  expect(flattenElements(recovered.wireframes[0].elements).some(element => element.text === '원본에만 속해야 할 미저장 초안')).toBeTruthy();
  expect(recovered.flowGroups[0].versions[0].wireframeVersions.find(version => version.id === fork.selectedWireframeVersionId)).toEqual(fork.flowGroups[0].versions[0].wireframeVersions.find(version => version.id === fork.selectedWireframeVersionId));
});

test('WC02: recovering a dirty origin never silently rebases over an independently edited source', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  await page.goto(`/#project/${original.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  const manual = await saveArtifact(request, original, 'wireframes', original.wireframes.map((screen, index) => index === 0 ? { ...screen, name: '다른 창에서 확정한 원본 이름' } : screen));
  const fork = await addWireVersion(request, manual);
  await page.getByTestId(`layer-${original.id}-nested-nested-title`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('이전 리비전 기반 미저장 초안');
  await expect(page.getByRole('button', { name: '편집하던 버전으로 돌아가 저장', exact: true })).toBeVisible();
  const conflictingSave = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/projects/${original.id}/artifacts/wireframes`));
  await page.getByRole('button', { name: '편집하던 버전으로 돌아가 저장', exact: true }).click();
  expect((await conflictingSave).status()).toBe(409);
  await expect(page.getByRole('button', { name: '저장 재시도', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '요소 내용', exact: true })).toHaveValue('이전 리비전 기반 미저장 초안');
  const latest = await getProject(request, original.id);
  expect(latest.selectedWireframeVersionId).toBe(original.selectedWireframeVersionId);
  expect(latest.wireframes).toEqual(manual.wireframes);
  expect(latest.flowGroups[0].versions[0].wireframeVersions.find(version => version.id === fork.selectedWireframeVersionId)).toEqual(fork.flowGroups[0].versions[0].wireframeVersions.find(version => version.id === fork.selectedWireframeVersionId));
});

test('WC03: externally archived dirty source remains recoverable and only saves after explicit restore', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const project = await addWireVersion(request, original);
  const sourceId = project.selectedWireframeVersionId!;
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  const archivedResponse = await request.post(`${wirePath(project)}/${sourceId}/archive`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(archivedResponse.ok()).toBeTruthy();
  const archived = await archivedResponse.json();
  await page.getByTestId(`layer-${project.id}-nested-nested-title`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('휴지통에서도 보존할 원본 초안');
  const recovery = page.getByRole('button', { name: '원래 버전 복원 후 돌아가 저장', exact: true });
  await expect(recovery).toBeVisible();
  await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
  expect(await getProject(request, project.id)).toEqual(archived);
  await expect(page.getByRole('textbox', { name: '요소 내용', exact: true })).toHaveValue('휴지통에서도 보존할 원본 초안');
  await recovery.click();
  await expect(page.getByRole('status').filter({ hasText: '모든 변경 저장됨' })).toBeVisible();
  const recovered = await getProject(request, project.id);
  expect(recovered.selectedWireframeVersionId).toBe(sourceId);
  expect(activeFlow(recovered).wireframeVersions.find(version => version.id === sourceId)?.archivedAt).toBeNull();
  expect(JSON.stringify(recovered.wireframes)).toContain('휴지통에서도 보존할 원본 초안');
  expect(activeFlow(recovered).wireframeVersions.find(version => version.id === original.selectedWireframeVersionId)).toEqual(activeFlow(original).wireframeVersions[0]);
});
