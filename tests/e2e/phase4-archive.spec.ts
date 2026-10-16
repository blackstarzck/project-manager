import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import type { Project } from '../../shared/schema.js';
import { API, mutationHeaders } from '../fixtures.js';
import { addFlowVersion, getProject, seedNestedProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, addWireVersion, allFlows, awaitRun, runProposal, selectWireVersion, wirePath, wireRun } from '../phase4-fixtures.js';

async function action(request: APIRequestContext, project: Project, suffix: string) {
  const response = await request.post(`${API}/projects/${project.id}/${suffix}`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json() as Promise<Project>;
}
test('RA01: archived screen source blocks selection, copy, saves and approval; restore preserves pending proposal and last active sibling', async ({ request }) => {
  const original = await seedNestedProject(request);
  let project = await addWireVersion(request, original, true, '보관할 화면 버전');
  const source = activeWire(project);
  const run = await awaitRun(request, await wireRun(request, project, 'regenerate', '보관 후 복원할 AI 화면', [project.wireframes[0].id]));
  const originPath = `flow-versions/${project.selectedFlowVersionId}/wireframe-versions/${source.id}`;
  project = await action(request, project, `${originPath}/archive`);
  expect(project.selectedWireframeVersionId).toBe(original.selectedWireframeVersionId);
  const archived = activeFlow(project).wireframeVersions.find(version => version.id === source.id)!;
  expect(archived.archivedAt).toBeTruthy(); expect(archived.wireframes).toEqual(source.wireframes);
  for (const response of [
    await request.post(`${API}/projects/${project.id}/${originPath}/select`, { headers: mutationHeaders, data: { expectedRevision: project.revision } }),
    await request.post(wirePath(project), { headers: mutationHeaders, data: { expectedRevision: project.revision, sourceWireframeVersionId: source.id } }),
    await request.put(`${API}/projects/${project.id}/artifacts/wireframes`, { headers: mutationHeaders, data: { expectedRevision: source.wireframeRevision, flowVersionId: project.selectedFlowVersionId, wireframeVersionId: source.id, value: source.wireframes } }),
    await request.post(`${API}/proposals/${run.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } }),
  ]) { expect(response.status(), await response.text()).toBe(409); expect(await response.text()).toContain('VERSION_ARCHIVED'); }
  expect((await runProposal(request, run)).status).toBe('pending');
  const last = await request.post(`${wirePath(project)}/${project.selectedWireframeVersionId}/archive`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(last.status()).toBe(409); expect(await last.text()).toContain('LAST_ACTIVE_VERSION');
  expect(await getProject(request, project.id)).toEqual(project);
  project = await action(request, project, `${originPath}/restore`);
  expect(project.selectedWireframeVersionId).toBe(original.selectedWireframeVersionId);
  expect(activeFlow(project).wireframeVersions.find(version => version.id === source.id)?.wireframes).toEqual(source.wireframes);
  project = await selectWireVersion(request, project, source.id);
  const approval = await request.post(`${API}/proposals/${run.proposalId}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } });
  expect(approval.ok(), await approval.text()).toBeTruthy();
  expect(activeFlow(await getProject(request, project.id)).wireframeVersions).toHaveLength(3);
});

test('RA02: flow and group archive use deterministic fallback and restore only the requested hierarchy level', async ({ request }) => {
  const original = await seedNestedProject(request);
  let project = await addFlowVersion(request, original, { copy: true, name: '그룹 첫 수정본' });
  const flowToArchive = project.selectedFlowVersionId!;
  project = await addFlowVersion(request, project, { copy: true, name: '가장 최근 수정본' });
  const latestFlowId = project.selectedFlowVersionId!;
  project = await action(request, project, `flow-versions/${latestFlowId}/archive`);
  expect(project.selectedFlowVersionId).toBe(flowToArchive);
  project = await action(request, project, `flow-versions/${flowToArchive}/archive`);
  expect(project.selectedFlowVersionId).toBe(original.selectedFlowVersionId);
  project = await addFlowVersion(request, project, { copy: true, group: true, name: '두 번째 그룹' });
  const secondGroupId = activeFlow(project).groupId;
  project = await action(request, project, `flow-groups/${original.flowGroups[0].id}/archive`);
  const wrongParent = await request.post(`${API}/projects/${project.id}/flow-versions/${flowToArchive}/restore`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(wrongParent.status()).toBe(409);
  expect(await wrongParent.text()).toContain('VERSION_ARCHIVED');
  const lastGroup = await request.post(`${API}/projects/${project.id}/flow-groups/${secondGroupId}/archive`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(lastGroup.status()).toBe(409);
  const selectedBeforeRestore = project.selectedFlowVersionId;
  project = await action(request, project, `flow-groups/${original.flowGroups[0].id}/restore`);
  expect(project.selectedFlowVersionId).toBe(selectedBeforeRestore);
  expect(allFlows(project).find(flow => flow.id === flowToArchive)?.archivedAt).toBeTruthy();
  project = await action(request, project, `flow-versions/${flowToArchive}/restore`);
  expect(project.selectedFlowVersionId).toBe(selectedBeforeRestore);
  expect(allFlows(project).find(flow => flow.id === flowToArchive)?.archivedAt).toBeNull();
  expect(allFlows(project).find(flow => flow.id === latestFlowId)?.archivedAt).toBeTruthy();
  expect(allFlows(project).find(flow => flow.id === flowToArchive)?.wireframes).toEqual(original.wireframes);
});

test('RU01: screen archive flushes the draft, switches to a valid sibling and restores preserved contents without selecting them', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const project = await addWireVersion(request, original, true, '검토 완료 화면');
  const archiveId = project.selectedWireframeVersionId!;
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByTestId(`layer-${project.id}-nested-nested-title`).click();
  await page.getByRole('textbox', { name: '요소 내용', exact: true }).fill('보관 직전에 수정한 화면 제목');
  await page.getByRole('button', { name: '화면 버전 휴지통으로 이동', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '버전을 휴지통으로 이동', exact: true });
  await confirm.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  const selector = page.getByRole('combobox', { name: '와이어프레임 버전 선택', exact: true });
  await expect(selector).toHaveValue(original.selectedWireframeVersionId!);
  const archived = await getProject(request, project.id);
  expect(archived.wireframes).toEqual(original.wireframes);
  const history = activeFlow(archived).wireframeVersions.find(version => version.id === archiveId)!;
  expect(history.archivedAt).toBeTruthy();
  expect(JSON.stringify(history.wireframes)).toContain('보관 직전에 수정한 화면 제목');
  await page.getByRole('button', { name: '버전 휴지통 열기', exact: true }).click();
  const trash = page.getByRole('dialog', { name: '버전 휴지통', exact: true });
  await expect(trash.getByTestId(`restore-wireframe-${archiveId}`)).toBeEnabled();
  await page.screenshot({ path: 'tests/artifacts/phase4-version-trash.png', fullPage: true });
  await trash.getByTestId(`restore-wireframe-${archiveId}`).click();
  await expect(trash.getByTestId(`restore-wireframe-${archiveId}`)).toHaveCount(0);
  await trash.locator('.modal-footer').getByRole('button', { name: '닫기', exact: true }).click();
  await expect(selector).toHaveValue(original.selectedWireframeVersionId!);
  await selector.selectOption(archiveId);
  await expect(page.getByTestId(`wire-element-${project.id}-nested-nested-title`)).toContainText('보관 직전에 수정한 화면 제목');
});
