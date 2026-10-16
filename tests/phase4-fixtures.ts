import { expect, type APIRequestContext } from '@playwright/test';
import type { AiRun, Project, ProjectActivity, WireframeGenerationMode } from '../shared/schema.js';
import { API, mutationHeaders } from './fixtures.js';

export const allFlows = (project: Project) => project.flowGroups.flatMap(group => group.versions);
export const allWireVersions = (project: Project) => allFlows(project).flatMap(flow => flow.wireframeVersions);
export const activeFlow = (project: Project) => allFlows(project).find(flow => flow.id === project.selectedFlowVersionId)!;
export const activeWire = (project: Project) => activeFlow(project).wireframeVersions.find(version => version.id === project.selectedWireframeVersionId)!;
export const wirePath = (project: Project, flowId = project.selectedFlowVersionId!) => `${API}/projects/${project.id}/flow-versions/${flowId}/wireframe-versions`;

export async function addWireVersion(request: APIRequestContext, project: Project, copy = true, name = '독립 화면 수정본'): Promise<Project> {
  const response = await request.post(wirePath(project), { headers: mutationHeaders, data: { expectedRevision: project.revision, name, ...(copy ? { sourceWireframeVersionId: project.selectedWireframeVersionId } : {}) } });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
export async function selectWireVersion(request: APIRequestContext, project: Project, wireframeVersionId: string, flowVersionId = project.selectedFlowVersionId!): Promise<Project> {
  const response = await request.post(`${wirePath(project, flowVersionId)}/${wireframeVersionId}/select`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
export async function wireRun(request: APIRequestContext, project: Project, wireframeGenerationMode: WireframeGenerationMode, prompt: string, entityIds: string[] = []): Promise<AiRun> {
  const response = await request.post(`${API}/projects/${project.id}/ai/runs`, { headers: mutationHeaders, data: { artifact: 'wireframes', prompt, entityIds, flowVersionId: project.selectedFlowVersionId, wireframeVersionId: project.selectedWireframeVersionId, wireframeGenerationMode } });
  expect(response.status(), await response.text()).toBe(202);
  return response.json();
}
export async function awaitRun(request: APIRequestContext, run: AiRun, status: AiRun['status'] = 'succeeded') {
  let current = run;
  await expect.poll(async () => { current = await (await request.get(`${API}/ai/runs/${run.id}`)).json(); return current.status; }).toBe(status);
  return current;
}
export async function runProposal(request: APIRequestContext, run: AiRun) {
  const activity: ProjectActivity = await (await request.get(`${API}/projects/${run.projectId}/activity`)).json();
  return activity.proposals.find(proposal => proposal.id === run.proposalId)!;
}
export function assertWireProjection(project: Project) {
  const flow = activeFlow(project), wire = activeWire(project);
  expect(flow.selectedWireframeVersionId).toBe(project.selectedWireframeVersionId);
  expect(wire.flowVersionId).toBe(flow.id);
  expect(project.wireframes).toEqual(wire.wireframes);
  expect(flow.wireframes).toEqual(wire.wireframes);
  expect(project.artifactRevisions.wireframes).toBe(wire.wireframeRevision);
  expect(flow.wireframeRevision).toBe(wire.wireframeRevision);
}
