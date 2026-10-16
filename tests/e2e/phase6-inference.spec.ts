import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { applyNavigationInference, inferNavigationCandidates } from '../../shared/wireframe-navigation-inference.js';
import type { Project, WireElement, WireScreen } from '../../shared/schema.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { flattenElements, getProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, addWireVersion, awaitRun, runProposal, wireRun } from '../phase4-fixtures.js';
import { inferenceScreens, seedInferenceProject } from '../phase6-fixtures.js';

const header = (screen: WireScreen) => screen.elements.find(element => element.type === 'header')!;
function bindHeader(screens: WireScreen[], sourceIndex: number, targetIndex: number) {
  const source = screens[sourceIndex], target = screens[targetIndex];
  const originals = flattenElements([header(source)]), copies = flattenElements([header(target)]);
  target.navigationSync = { ...target.navigationSync, header: { sourceScreenId: source.id, sourceElementId: header(source).id, elementIdMap: Object.fromEntries(originals.map((element, index) => [element.id, copies[index].id])) } };
}

test('IN01: inference matches ID-independent region semantics and applies only metadata with every body and modal link intact', async ({ request }) => {
  const project = await seedInferenceProject(request);
  const screens = inferenceScreens(project); // Preserve deliberately different style-property ordering before schema normalization.
  const before = structuredClone(screens), analysis = inferNavigationCandidates(screens);
  expect(analysis.candidates.map(candidate => candidate.region)).toEqual(['header', 'sidebar', 'footer']);
  for (const candidate of analysis.candidates) {
    expect(candidate.sourceScreenId).toBe(screens[0].id);
    expect(candidate.targetScreenIds).toEqual(screens.slice(1, 3).map(screen => screen.id));
  }
  expect(screens).toEqual(before);
  const candidate = analysis.candidates.find(item => item.region === 'header')!;
  const linked = applyNavigationInference(screens, analysis, [{ candidateId: candidate.id, targetScreenIds: [screens[1].id] }]);
  expect(linked.map(screen => screen.elements)).toEqual(before.map(screen => screen.elements));
  expect(linked[0]).toBe(screens[0]); expect(linked[2]).toBe(screens[2]); expect(linked[3]).toBe(screens[3]);
  const binding = linked[1].navigationSync!.header!;
  expect(binding.elementIdMap[`${screens[0].id}-infer-header-modal`]).toBe(`${screens[1].id}-infer-header-modal`);
  expect(flattenElements(linked[1].elements).find(element => element.id.endsWith('-body-open-help'))?.targetElementId).toBe(`${screens[1].id}-infer-header-modal`);
  expect(screens).toEqual(before);
});

test('IN02: different content, destination, action, order, style, device and ambiguous/external regions never become false header matches', async ({ request }) => {
  const project = await seedInferenceProject(request);
  const variants: ((screens: WireScreen[]) => void)[] = [
    screens => { header(screens[1]).children![0].text += ' 다른 이름'; },
    screens => { header(screens[1]).children![1].targetScreenId = screens[1].id; },
    screens => { header(screens[1]).children![1].action = 'back'; },
    screens => { header(screens[1]).children!.reverse(); },
    screens => { header(screens[1]).style!.padding = 17; },
    screens => { screens[1].device = 'tablet'; },
    screens => { screens[1].elements.push({ id: 'ambiguous-header', type: 'header', text: '두 번째 헤더', targetScreenId: null }); },
    screens => { screens[1].elements.push({ id: 'outside-modal', type: 'modal', text: '본문 안내', targetScreenId: null }); header(screens[1]).children![2].targetElementId = 'outside-modal'; },
  ];
  for (const mutate of variants) {
    const pair = structuredClone(project.wireframes.slice(0, 2)); mutate(pair);
    const snapshot = structuredClone(pair);
    expect(inferNavigationCandidates(pair).candidates.filter(candidate => candidate.region === 'header')).toEqual([]);
    expect(pair).toEqual(snapshot);
  }
  const empty = project.wireframes.slice(0, 2).map((screen, index) => ({ ...screen, elements: [{ id: `empty-${index}`, type: 'header' as const, text: ' ', targetScreenId: null }] }));
  expect(inferNavigationCandidates(empty).candidates).toEqual([]);
  const modalOnly = empty.map((screen, index) => ({ ...screen, elements: [{ id: `modal-${index}`, type: 'modal' as const, text: '', targetScreenId: null, children: [{ id: `inside-${index}`, type: 'header' as const, text: '모달 전용 제목', targetScreenId: null }] }] }));
  expect(inferNavigationCandidates(modalOnly).candidates).toEqual([]);
});

test('IN03: existing ownership and opt-out are preserved, and two matching owners are never merged', async ({ request }) => {
  const project = await seedInferenceProject(request);
  const screens = structuredClone(project.wireframes); bindHeader(screens, 2, 1);
  const candidate = inferNavigationCandidates(screens).candidates.find(item => item.region === 'header')!;
  expect(candidate.sourceScreenId).toBe(screens[2].id); expect(candidate.targetScreenIds).toEqual([screens[0].id]);
  const excluded = structuredClone(project.wireframes); excluded[0].navigationInferenceExcluded = true;
  const remaining = inferNavigationCandidates(excluded).candidates.find(item => item.region === 'header')!;
  expect(remaining.sourceScreenId).toBe(excluded[1].id); expect(remaining.targetScreenIds).toEqual([excluded[2].id]);
  const owners = structuredClone(project.wireframes); owners[3].device = 'desktop'; bindHeader(owners, 0, 1); bindHeader(owners, 2, 3);
  const snapshot = structuredClone(owners), result = inferNavigationCandidates(owners);
  expect(result.candidates.filter(item => item.region === 'header')).toEqual([]);
  expect(result.skipped.some(item => item.region === 'header' && item.reason.includes('둘 이상'))).toBe(true);
  expect(owners).toEqual(snapshot);
});

test('IN04: stale snapshots, forged candidate maps and duplicate selections cannot change original screen data', async ({ request }) => {
  const project = await seedInferenceProject(request), original = project.wireframes;
  const analysis = inferNavigationCandidates(original), candidate = analysis.candidates[0];
  const changed = structuredClone(original); header(changed[0]).children![0].text = '분석 후 바뀐 제목';
  const before = structuredClone(changed);
  expect(() => applyNavigationInference(changed, analysis, [{ candidateId: candidate.id, targetScreenIds: [original[1].id] }])).toThrow(/다시 분석/);
  expect(changed).toEqual(before);
  for (const selections of [
    [{ candidateId: 'unknown', targetScreenIds: [original[1].id] }],
    [{ candidateId: candidate.id, targetScreenIds: [original[1].id, original[1].id] }],
    [{ candidateId: candidate.id, targetScreenIds: [original[3].id] }],
    [{ candidateId: candidate.id, targetScreenIds: [original[1].id] }, { candidateId: candidate.id, targetScreenIds: [original[2].id] }],
  ]) expect(() => applyNavigationInference(original, analysis, selections)).toThrow();
  const forged = structuredClone(analysis); forged.candidates[0].elementIdMaps[original[1].id] = { fake: 'body-element' };
  const linked = applyNavigationInference(original, forged, [{ candidateId: candidate.id, targetScreenIds: [original[1].id] }]);
  expect(linked[1].navigationSync!.header!.elementIdMap).toEqual(candidate.elementIdMaps[original[1].id]);
  expect(linked.map(screen => screen.elements)).toEqual(original.map(screen => screen.elements));
  expect(await getProject(request, project.id)).toEqual(project);
});

test('IN05: inferred bindings survive persistence, version copy, backup and clone without changing existing identity or references', async ({ request }) => {
  let project = await seedInferenceProject(request);
  const original = structuredClone(project), analysis = inferNavigationCandidates(project.wireframes);
  const linked = applyNavigationInference(project.wireframes, analysis, analysis.candidates.map(candidate => ({ candidateId: candidate.id, targetScreenIds: candidate.targetScreenIds })));
  project = await saveArtifact(request, project, 'wireframes', linked);
  expect(project.wireframes.map(screen => screen.elements)).toEqual(original.wireframes.map(screen => screen.elements));
  const source = activeWire(project);
  let copy = await addWireVersion(request, project);
  const changed = structuredClone(copy.wireframes); header(changed[0]).children![0].text = '새 버전의 도서관';
  copy = await saveArtifact(request, copy, 'wireframes', changed);
  expect(activeFlow(copy).wireframeVersions[0]).toEqual(source);
  expect(header(copy.wireframes[1]).children![0].text).toBe('새 버전의 도서관');
  const backup = await (await request.get(`${API}/projects/${copy.id}/backup`)).json();
  for (const response of [await request.post(`${API}/projects/${copy.id}/duplicate`, { headers: mutationHeaders, data: {} }), await request.post(`${API}/backups/restore`, { headers: mutationHeaders, data: backup })]) {
    expect(response.ok(), await response.text()).toBeTruthy(); const restored = await response.json() as Project;
    const binding = restored.wireframes[1].navigationSync!.header!, sourceScreen = restored.wireframes[0], target = restored.wireframes[1];
    expect(binding.sourceScreenId).toBe(sourceScreen.id); expect(binding.sourceScreenId).not.toBe(copy.wireframes[0].id);
    const sourceModal = flattenElements(sourceScreen.elements).find(element => element.type === 'modal')!, targetModal = flattenElements(target.elements).find(element => element.type === 'modal')!;
    expect(binding.elementIdMap[sourceModal.id]).toBe(targetModal.id);
    expect(flattenElements(target.elements).find(element => element.text === '본문에서 안내 열기')?.targetElementId).toBe(targetModal.id);
    expect(header(target).children![0].text).toBe('새 버전의 도서관');
  }
});

test('IN06: AI edit and regenerate preserve opt-out policy and never establish inference ownership themselves', async ({ request }) => {
  let project = await seedInferenceProject(request);
  project = await saveArtifact(request, project, 'wireframes', project.wireframes.map((screen, index) => index === 0 ? { ...screen, navigationInferenceExcluded: true } : screen));
  for (const mode of ['edit', 'regenerate'] as const) {
    const before = structuredClone(project);
    const run = await awaitRun(request, await wireRun(request, project, mode, '제외한 화면 내용만 개선', [project.wireframes[0].id]));
    const proposal = await runProposal(request, run);
    const response = await request.post(`${API}/proposals/${proposal.id}/resolve`, { headers: mutationHeaders, data: { action: 'approve', commandId: randomUUID() } });
    expect(response.ok(), await response.text()).toBeTruthy(); project = (await response.json()).project;
    expect(project.wireframes[0].navigationInferenceExcluded).toBe(true);
    expect(project.wireframes.every(screen => !screen.navigationSync)).toBe(true);
    expect(project.wireframes.slice(1)).toEqual(before.wireframes.slice(1));
    const backup = await (await request.get(`${API}/projects/${project.id}/backup`)).json();
    const imported = await request.post(`${API}/backups/restore`, { headers: mutationHeaders, data: backup });
    expect(imported.ok()).toBeTruthy(); expect((await imported.json() as Project).wireframes[0].navigationInferenceExcluded).toBe(true);
  }
});
