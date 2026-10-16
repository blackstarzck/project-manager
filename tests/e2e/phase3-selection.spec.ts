import { expect, test } from '@playwright/test';
import { saveArtifact } from '../fixtures.js';
import { getProject, seedNestedProject } from '../phase2-fixtures.js';

test('S01: canceling screen selection starts no run and adding one missing page preserves every existing screen', async ({ page, request }) => {
  const original = await seedNestedProject(request);
  const missingIds = ['extra-a', 'extra-b'].map(id => `${original.id}-${id}`);
  const project = await saveArtifact(request, original, 'flow', { ...original.flow, nodes: [...original.flow.nodes,
    ...missingIds.map((id, index) => ({ id, type: 'page' as const, label: index ? '관리자 통계' : '회원 대출 목록', description: '', position: { x: 700, y: index * 160 }, featureIds: [], sectionId: null })),
  ] });
  const started: unknown[] = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(`/api/projects/${project.id}/ai/runs`)) started.push(req.postDataJSON()); });
  await page.goto(`/#project/${project.id}`);
  await page.getByRole('tab', { name: '와이어프레임', exact: true }).click();
  await page.getByRole('button', { name: '미생성 화면 만들기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '와이어프레임 생성 대상 선택', exact: true });
  await expect(dialog.getByRole('radio', { name: '미생성 페이지 추가', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(started).toHaveLength(0);
  await page.getByRole('button', { name: '미생성 화면 만들기', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '대상 전체 선택', exact: true }).uncheck();
  await expect(dialog.getByRole('button', { name: '선택한 화면 생성 요청', exact: true })).toBeDisabled();
  await dialog.getByTestId(`wireframe-target-${missingIds[0]}`).check();
  await dialog.getByRole('textbox', { name: '화면 생성 추가 요청', exact: true }).fill('[QA_MISSING_SCREENS] 회원 대출 화면만 생성');
  await page.screenshot({ path: 'tests/artifacts/phase3-wireframe-selection.png', fullPage: true });
  await dialog.getByRole('button', { name: '선택한 화면 생성 요청', exact: true }).click();
  await page.getByRole('button', { name: '변경 제안 검토', exact: true }).click();
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ artifact: 'wireframes', entityIds: [missingIds[0]], flowVersionId: project.selectedFlowVersionId });
  expect(await getProject(request, project.id)).toEqual(project);
  await page.getByRole('button', { name: '선택 승인', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const result = await getProject(request, project.id);
  expect(result.wireframes).toHaveLength(project.wireframes.length + 1);
  for (const screen of project.wireframes) expect(result.wireframes.find(candidate => candidate.id === screen.id)).toEqual(screen);
  expect(result.wireframes.find(screen => screen.flowNodeId === missingIds[0])?.name).toBe('회원 대출 목록');
  expect(result.wireframes.some(screen => screen.flowNodeId === missingIds[1])).toBeFalsy();
});
