import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import type { AiRun, Project, WireElement, WireframePageTask } from '../shared/schema.js';
import { API, mutationHeaders, saveArtifact } from './fixtures.js';
import { seedNestedProject } from './phase2-fixtures.js';

export async function seedThreePageProject(request: APIRequestContext): Promise<Project> {
  let project = await seedNestedProject(request);
  const pageId = `${project.id}-page-account`;
  project = await saveArtifact(request, project, 'flow', { ...project.flow, nodes: [...project.flow.nodes, { id: pageId, type: 'page', label: '회원 대출 현황', description: '', position: { x: 720, y: 0 }, featureIds: [], sectionId: null }] });
  return saveArtifact(request, project, 'wireframes', [...project.wireframes, { id: `${project.id}-screen-account`, revision: 0, flowNodeId: pageId, flowRevision: project.artifactRevisions.flow, device: 'desktop', name: '회원 대출 현황', elements: [{ id: `${project.id}-account-title`, type: 'heading', text: '현재 대출한 도서', targetScreenId: null }] }]);
}
export async function readRun(request: APIRequestContext, id: string): Promise<AiRun> {
  const response = await request.get(`${API}/ai/runs/${id}`);
  expect(response.ok()).toBeTruthy(); return response.json();
}
export function taskFor(run: AiRun, pageId: string | null, screenId?: string): WireframePageTask {
  const task = run.pageTasks?.find(task => task.pageId === pageId && (!screenId || task.screenIds.includes(screenId)));
  expect(task, `Missing task for page ${pageId}`).toBeTruthy(); return task!;
}
export async function retryPages(request: APIRequestContext, run: AiRun, pageTaskIds?: string[], commandId = randomUUID()): Promise<AiRun> {
  const response = await request.post(`${API}/ai/runs/${run.id}/retry-pages`, { headers: mutationHeaders, data: { commandId, ...(pageTaskIds ? { pageTaskIds } : {}) } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}
export async function preparePages(request: APIRequestContext, run: AiRun, commandId = randomUUID()): Promise<AiRun> {
  const response = await request.post(`${API}/ai/runs/${run.id}/prepare-proposal`, { headers: mutationHeaders, data: { commandId } });
  expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
}

/** Fixture construction is deliberately independent of the production synchronization helper. */
export function linkedHeaders(project: Project, targetIndices = [1]): Project['wireframes'] {
  const screens = structuredClone(project.wireframes), source = screens[0];
  const header = source.elements.find(element => element.type === 'header')!;
  for (const index of targetIndices) {
    const target = screens[index], elementIdMap: Record<string, string> = {};
    const assign = (element: WireElement) => { elementIdMap[element.id] = `${target.id}-shared-${element.id}`; element.children?.forEach(assign); };
    assign(header);
    const copy = (element: WireElement): WireElement => ({ ...structuredClone(element), id: elementIdMap[element.id], ...(element.children ? { children: element.children.map(copy) } : {}), ...(element.targetElementId ? { targetElementId: elementIdMap[element.targetElementId] || null } : {}) });
    const prior = target.elements.findIndex(element => element.type === 'header');
    if (prior < 0) target.elements.unshift(copy(header)); else target.elements[prior] = copy(header);
    target.navigationSync = { header: { sourceScreenId: source.id, sourceElementId: header.id, elementIdMap } };
  }
  return screens;
}
