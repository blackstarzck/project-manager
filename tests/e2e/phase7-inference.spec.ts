import { expect, test } from '@playwright/test';
import type { Project, WireElement, WireScreen } from '../../shared/schema.js';
import { applyNavigationInference, inferNavigationCandidates } from '../../shared/wireframe-navigation-inference.js';
import { API, mutationHeaders, saveArtifact } from '../fixtures.js';
import { flattenElements, getProject } from '../phase2-fixtures.js';
import { activeFlow, activeWire, addWireVersion } from '../phase4-fixtures.js';
import { seedInferenceProject } from '../phase6-fixtures.js';
import { pageHeader, seedGeneratedNavigation, seedMissingNavigation, seedSimilarNavigation } from '../phase7-fixtures.js';

const extended = (screens: WireScreen[]) => inferNavigationCandidates(screens, { extended: true });
const nav = (screen: WireScreen) => pageHeader(screen).children!.find(element => element.type === 'nav')!;
const bodyElements = (screen: WireScreen) => screen.elements.filter(element => element.type !== 'header');
const bindHeader = (screens: WireScreen[], source: number, target: number) => {
  const originals = flattenElements([pageHeader(screens[source])]), copies = flattenElements([pageHeader(screens[target])]);
  screens[target].navigationSync = { header: { sourceScreenId: screens[source].id, sourceElementId: originals[0].id, elementIdMap: Object.fromEntries(originals.map((element, index) => [element.id, copies[index].id])) } };
};

test('EX01: extended discovery distinguishes exact and changed menus without weakening the legacy exact-only API', async ({ request }) => {
  const project = await seedSimilarNavigation(request), snapshot = structuredClone(project.wireframes);
  const exact = inferNavigationCandidates(project.wireframes).candidates.find(candidate => candidate.region === 'header')!;
  expect(exact.targetScreenIds).toEqual([project.wireframes[2].id]);
  const candidate = extended(project.wireframes).candidates.find(item => item.region === 'header')!;
  expect(candidate.kind).toBe('similar');
  expect(candidate.targets.map(target => [target.screenId, target.kind])).toEqual([[project.wireframes[1].id, 'similar'], [project.wireframes[2].id, 'exact']]);
  const changes = candidate.targets[0].differences;
  expect(changes.some(change => change.field === 'text' && change.before === '책 찾아보기' && change.after === '도서 검색')).toBe(true);
  expect(changes.some(change => change.field === 'style')).toBe(true);
  expect(candidate.targets[1].differences).toEqual([]);
  expect(project.wireframes).toEqual(snapshot); expect(await getProject(request, project.id)).toEqual(project);
});

test('EX02: changed menus require explicit permission and preserve every existing ID, body and modal reference', async ({ request }) => {
  const project = await seedSimilarNavigation(request), before = structuredClone(project.wireframes), analysis = extended(project.wireframes);
  const candidate = analysis.candidates.find(item => item.region === 'header')!, selected = [{ candidateId: candidate.id, targetScreenIds: [before[1].id] }];
  expect(() => applyNavigationInference(project.wireframes, analysis, selected)).toThrow();
  expect(project.wireframes).toEqual(before);
  const result = applyNavigationInference(project.wireframes, analysis, selected.map(selection => ({ ...selection, allowChanges: true })));
  expect(nav(result[1]).text).toBe(nav(before[0]).text);
  expect(pageHeader(result[1]).style).toEqual(pageHeader(before[0]).style);
  expect(flattenElements(result[1].elements).map(element => element.id)).toEqual(flattenElements(before[1].elements).map(element => element.id));
  expect(bodyElements(result[1])).toEqual(bodyElements(before[1]));
  expect(flattenElements(result[1].elements).find(element => element.id.endsWith('-body-open-help'))?.targetElementId).toBe(`${before[1].id}-infer-header-modal`);
  expect(result[0]).toEqual(before[0]); expect(result[2]).toEqual(before[2]); expect(result[3]).toEqual(before[3]);
});

test('EX03: extended matching still rejects changed actions, destinations, order, structure and non-menu content or styling', async ({ request }) => {
  const project = await seedInferenceProject(request);
  const changes: ((screens: WireScreen[]) => void)[] = [
    screens => { nav(screens[1]).action = 'back'; },
    screens => { nav(screens[1]).targetScreenId = screens[1].id; },
    screens => { pageHeader(screens[1]).children!.reverse(); },
    screens => { pageHeader(screens[1]).children!.push({ id: 'unmatched-extra', type: 'text', text: '추가', targetScreenId: null }); },
    screens => { pageHeader(screens[1]).children![0].text = '전혀 다른 서비스'; },
    screens => { pageHeader(screens[1]).children![0].style = { color: '#ff0000' }; },
    screens => { pageHeader(screens[1]).children![3].children![0].text = '다른 모달 안내'; },
    screens => { screens[1].device = 'tablet'; },
  ];
  for (const change of changes) {
    const screens = structuredClone(project.wireframes.slice(0, 2)); change(screens);
    const snapshot = structuredClone(screens);
    expect(extended(screens).candidates.filter(candidate => candidate.region === 'header')).toEqual([]);
    expect(screens).toEqual(snapshot);
  }
});

test('EX04: extended source ownership, ambiguity and opt-out remain protected even when free similar screens come first', async ({ request }) => {
  const project = await seedSimilarNavigation(request), screens = structuredClone(project.wireframes);
  bindHeader(screens, 2, 1);
  // Materialize the linked target independently, retaining its IDs.
  pageHeader(screens[1]).style = structuredClone(pageHeader(screens[2]).style);
  nav(screens[1]).text = nav(screens[2]).text; delete nav(screens[1]).style;
  nav(screens[0]).text = '검색 메뉴';
  const candidate = extended(screens).candidates.find(item => item.region === 'header')!;
  expect(candidate.sourceScreenId).toBe(screens[2].id); expect(candidate.targetScreenIds).toEqual([screens[0].id]);
  const before = structuredClone(screens);
  const linked = applyNavigationInference(screens, extended(screens), [{ candidateId: candidate.id, targetScreenIds: candidate.targetScreenIds, allowChanges: true }]);
  expect(linked[1]).toEqual(before[1]); expect(linked[2]).toEqual(before[2]);
  const owners = structuredClone(project.wireframes); owners[3].device = 'desktop'; bindHeader(owners, 0, 1); bindHeader(owners, 2, 3);
  expect(extended(owners).candidates.filter(item => item.region === 'header')).toEqual([]);
  const excluded = structuredClone(project.wireframes); excluded[1].navigationInferenceExcluded = true;
  expect(extended(excluded).candidates.every(item => item.sourceScreenId !== excluded[1].id && !item.targetScreenIds.includes(excluded[1].id))).toBe(true);
});

test('EX05: missing regions are copied only on reviewed targets with fresh IDs and valid internal modal mapping', async ({ request }) => {
  const project = await seedMissingNavigation(request), original = structuredClone(project.wireframes), analysis = extended(project.wireframes);
  const candidate = analysis.candidates.find(item => item.region === 'header')!;
  expect(candidate.targets.find(target => target.screenId === original[2].id)?.kind).toBe('missing');
  const used = new Set(original.flatMap(screen => flattenElements(screen.elements).map(element => element.id)));
  let calls = 0;
  const result = applyNavigationInference(project.wireframes, analysis, [{ candidateId: candidate.id, targetScreenIds: [original[2].id], allowChanges: true }], () => ++calls === 1 ? original[2].elements[0].id : `qa-fresh-${calls}`);
  expect(bodyElements(result[2])).toEqual(original[2].elements);
  expect(result[0]).toEqual(original[0]); expect(result[1]).toEqual(original[1]); expect(result[3]).toEqual(original[3]);
  const created = flattenElements([pageHeader(result[2])]);
  expect(created.every(element => !used.has(element.id))).toBe(true);
  expect(new Set(created.map(element => element.id)).size).toBe(created.length);
  const modal = created.find(element => element.type === 'modal')!;
  expect(created.find(element => element.action === 'openModal')?.targetElementId).toBe(modal.id);
  expect(result[2].navigationSync!.header!.sourceScreenId).toBe(original[0].id);
  expect(project.wireframes).toEqual(original);
  for (const region of ['sidebar', 'footer'] as const) {
    const screens = structuredClone(original);
    const remove = (items: WireElement[]): WireElement[] => items.filter(item => item.type !== region).map(item => ({ ...item, ...(item.children ? { children: remove(item.children) } : {}) }));
    screens[2].elements = remove(screens[2].elements);
    const prior = structuredClone(screens), analysis = extended(screens), candidate = analysis.candidates.find(item => item.region === region)!;
    expect(candidate.targets.find(target => target.screenId === screens[2].id)?.kind).toBe('missing');
    const filled = applyNavigationInference(screens, analysis, [{ candidateId: candidate.id, targetScreenIds: [screens[2].id], allowChanges: true }]);
    const currentElements = flattenElements(filled[2].elements);
    for (const element of flattenElements(prior[2].elements)) expect(currentElements.find(item => item.id === element.id)).toEqual(element);
    expect(filled[2].navigationSync?.[region]?.sourceScreenId).toBe(screens[0].id);
    expect(filled[0]).toEqual(prior[0]); expect(filled[1]).toEqual(prior[1]); expect(filled[3]).toEqual(prior[3]);
  }
});

test('EX06: a grounded generated header uses only eligible same-device pages and creates its source only after explicit target selection', async ({ request }) => {
  const project = await seedGeneratedNavigation(request), original = structuredClone(project.wireframes);
  const analysis = extended(original), candidate = analysis.candidates.find(item => item.kind === 'generated')!;
  expect(candidate.device).toBe('desktop'); expect(candidate.sourceScreenId).toBe(original[0].id);
  expect(candidate.targetScreenIds).toEqual(original.slice(1, 3).map(screen => screen.id));
  expect(applyNavigationInference(original, analysis, [])).toBe(original);
  expect(() => applyNavigationInference(original, analysis, [{ candidateId: candidate.id, targetScreenIds: [original[1].id] }])).toThrow();
  const result = applyNavigationInference(original, analysis, [{ candidateId: candidate.id, targetScreenIds: [original[1].id], allowChanges: true }]);
  for (const index of [0, 1]) {
    expect(bodyElements(result[index])).toEqual(original[index].elements);
    const menu = flattenElements([pageHeader(result[index])]).filter(element => element.action === 'navigate');
    expect(menu.map(element => [element.text, element.targetScreenId])).toEqual(original.slice(0, 3).map(screen => [screen.name, screen.id]));
  }
  expect(result[2]).toEqual(original[2]); expect(result[3]).toEqual(original[3]);
  expect(result[1].navigationSync!.header!.sourceScreenId).toBe(original[0].id);
  const excluded = structuredClone(original); excluded[2].navigationInferenceExcluded = true;
  const limited = extended(excluded).candidates.find(item => item.kind === 'generated')!;
  const applied = applyNavigationInference(excluded, extended(excluded), [{ candidateId: limited.id, targetScreenIds: limited.targetScreenIds, allowChanges: true }]);
  expect(flattenElements([pageHeader(applied[0])]).filter(element => element.action === 'navigate').map(element => element.targetScreenId)).toEqual(excluded.slice(0, 2).map(screen => screen.id));
  expect(applied[2]).toEqual(excluded[2]);
});

test('EX07: stale reviews, forged change flags and one oversized target reject the whole inference operation atomically', async ({ request }) => {
  const project = await seedSimilarNavigation(request), analysis = extended(project.wireframes), candidate = analysis.candidates.find(item => item.region === 'header')!;
  const forged = structuredClone(analysis); forged.candidates.find(item => item.id === candidate.id)!.targets.forEach(target => { target.kind = 'exact'; target.destructive = false; target.differences = []; });
  expect(() => applyNavigationInference(project.wireframes, forged, [{ candidateId: candidate.id, targetScreenIds: [project.wireframes[1].id] }])).toThrow();
  const changed = structuredClone(project.wireframes); nav(changed[0]).text = '분석 뒤 변경';
  expect(() => applyNavigationInference(changed, analysis, [{ candidateId: candidate.id, targetScreenIds: [changed[1].id], allowChanges: true }])).toThrow(/다시 분석/);
  const missing = await seedMissingNavigation(request), screens = structuredClone(missing.wireframes);
  screens[2].elements = Array.from({ length: 100 }, (_, index): WireElement => ({ id: `limit-${index}`, type: 'text', text: `보존할 기존 요소 ${index}`, targetScreenId: null }));
  const snapshot = structuredClone(screens), bounded = extended(screens), header = bounded.candidates.find(item => item.region === 'header')!;
  expect(() => applyNavigationInference(screens, bounded, [{ candidateId: header.id, targetScreenIds: [screens[1].id, screens[2].id], allowChanges: true }])).toThrow(/요소 구조가 올바르지/);
  expect(screens).toEqual(snapshot); expect(await getProject(request, missing.id)).toEqual(missing);
});

test('EX08: generated regions persist through isolated versions, HTML export, clone and backup with valid remapped links', async ({ request }) => {
  let project = await seedGeneratedNavigation(request), before = structuredClone(project);
  const analysis = extended(project.wireframes), candidate = analysis.candidates.find(item => item.kind === 'generated')!;
  project = await saveArtifact(request, project, 'wireframes', applyNavigationInference(project.wireframes, analysis, [{ candidateId: candidate.id, targetScreenIds: candidate.targetScreenIds, allowChanges: true }]));
  const source = activeWire(project); project = await addWireVersion(request, project);
  const changed = structuredClone(project.wireframes); pageHeader(changed[0]).children!.find(element => element.action === 'navigate')!.text = '복제 버전 메뉴';
  project = await saveArtifact(request, project, 'wireframes', changed);
  expect(activeFlow(project).wireframeVersions[0]).toEqual(source);
  expect(bodyElements(project.wireframes[1])).toEqual(before.wireframes[1].elements);
  const html = await request.get(`${API}/projects/${project.id}/export?format=html&flowVersionId=${project.selectedFlowVersionId}&wireframeVersionId=${project.selectedWireframeVersionId}`);
  expect(html.ok(), await html.text()).toBeTruthy(); expect(await html.text()).toContain('복제 버전 메뉴');
  const backup = await (await request.get(`${API}/projects/${project.id}/backup`)).json();
  for (const response of [await request.post(`${API}/projects/${project.id}/duplicate`, { headers: mutationHeaders, data: {} }), await request.post(`${API}/backups/restore`, { headers: mutationHeaders, data: backup })]) {
    expect(response.ok(), await response.text()).toBeTruthy(); const restored = await response.json() as Project;
    const ids = new Set(restored.wireframes.map(screen => screen.id));
    for (const screen of restored.wireframes.slice(0, 3)) {
      expect(flattenElements([pageHeader(screen)]).filter(element => element.action === 'navigate').every(element => ids.has(element.targetScreenId!))).toBe(true);
      const open = flattenElements(screen.elements).find(element => element.text === '개별 안내 열기')!;
      expect(flattenElements(screen.elements).find(element => element.id === open.targetElementId)?.type).toBe('modal');
    }
    expect(restored.wireframes[1].navigationSync!.header!.sourceScreenId).toBe(restored.wireframes[0].id);
    expect(restored.wireframes[0].id).not.toBe(project.wireframes[0].id);
  }
});
