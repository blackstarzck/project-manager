import type { Artifact, AiRun, AiStatus, FlowGenerationMode, WireframeGenerationMode, Project, ProjectActivity, ProjectSummary, Proposal, Revision } from '../shared/schema';

export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'ProjectManager' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new ApiError(error.error || `요청을 처리하지 못했습니다 (${response.status})`, response.status, error.code); }
  return response.json();
}
export const api = {
  projects: (archived = false) => request<ProjectSummary[]>(`/projects${archived ? '?archived=true' : ''}`),
  project: (id: string) => request<Project>(`/projects/${id}`),
  create: (name: string, description: string) => request<Project>('/projects', 'POST', { name, description }),
  patch: (project: Project, patch: Partial<Project> & { archived?: boolean }) => request<Project>(`/projects/${project.id}`, 'PATCH', { ...patch, expectedRevision: project.revision }),
  duplicate: (id: string) => request<Project>(`/projects/${id}/duplicate`, 'POST', {}),
  save: (project: Project, artifact: Artifact, value: Project[Artifact]) => request<Project>(`/projects/${project.id}/artifacts/${artifact}`, 'PUT', { expectedRevision: project.artifactRevisions[artifact], value, ...(['flow','wireframes'].includes(artifact) ? { flowVersionId: project.selectedFlowVersionId || undefined } : {}), ...(artifact === 'wireframes' ? { wireframeVersionId: project.selectedWireframeVersionId || undefined } : {}) }),
  status: () => request<AiStatus>('/ai/status'),
  activity: (id: string) => request<ProjectActivity>(`/projects/${id}/activity`),
  run: (id: string, artifact: Artifact, prompt: string, model?: string, entityIds?: string[], flowVersionId?: string, flowGenerationMode?: FlowGenerationMode, wireframeVersionId?: string, wireframeGenerationMode?: WireframeGenerationMode) => request<AiRun>(`/projects/${id}/ai/runs`, 'POST', { artifact, prompt, model, entityIds, flowVersionId, flowGenerationMode, wireframeVersionId, wireframeGenerationMode }),
  poll: (id: string) => request<AiRun>(`/ai/runs/${id}`),
  cancel: (id: string) => request<AiRun>(`/ai/runs/${id}/cancel`, 'POST', {}),
  retryPages: (id: string, pageTaskIds?: string[]) => request<AiRun>(`/ai/runs/${id}/retry-pages`, 'POST', { pageTaskIds, commandId: crypto.randomUUID() }),
  preparePageProposal: (id: string) => request<AiRun>(`/ai/runs/${id}/prepare-proposal`, 'POST', { commandId: crypto.randomUUID() }),
  resolve: (id: string, action: 'approve' | 'reject', changeIds?: string[], allowPartial?: boolean) => request<{ project: Project; proposal: Proposal }>(`/proposals/${id}/resolve`, 'POST', { action, changeIds, allowPartial, commandId: crypto.randomUUID() }),
  revisions: (id: string) => request<Revision[]>(`/projects/${id}/revisions`),
  revisionSnapshot: (projectId: string, revisionId: string) => request<Project>(`/projects/${projectId}/revisions/${revisionId}`),
  restoreRevision: (project: Project, id: string) => request<Project>(`/projects/${project.id}/revisions/${id}/restore`, 'POST', { expectedRevision: project.revision }),
  restoreBackup: (value: unknown) => request<Project>('/backups/restore', 'POST', value),
  createFlowGroup: (project: Project, name: string, sourceVersionId?: string) => request<Project>(`/projects/${project.id}/flow-groups`, 'POST', { name, expectedRevision: project.revision, sourceVersionId }),
  createFlowVersion: (project: Project, groupId: string, name: string, sourceVersionId?: string) => request<Project>(`/projects/${project.id}/flow-groups/${groupId}/versions`, 'POST', { name, expectedRevision: project.revision, sourceVersionId }),
  selectFlowVersion: (project: Project, versionId: string) => request<Project>(`/projects/${project.id}/flow-versions/${versionId}/select`, 'POST', { expectedRevision: project.revision }),
  renameFlowGroup: (project: Project, groupId: string, name: string) => request<Project>(`/projects/${project.id}/flow-groups/${groupId}`, 'PATCH', { name, expectedRevision: project.revision }),
  renameFlowVersion: (project: Project, versionId: string, name: string) => request<Project>(`/projects/${project.id}/flow-versions/${versionId}`, 'PATCH', { name, expectedRevision: project.revision }),
  createWireframeVersion: (project: Project, flowVersionId: string, name: string, sourceWireframeVersionId?: string) => request<Project>(`/projects/${project.id}/flow-versions/${flowVersionId}/wireframe-versions`, 'POST', { name, sourceWireframeVersionId, expectedRevision: project.revision }),
  selectWireframeVersion: (project: Project, flowVersionId: string, wireframeVersionId: string) => request<Project>(`/projects/${project.id}/flow-versions/${flowVersionId}/wireframe-versions/${wireframeVersionId}/select`, 'POST', { expectedRevision: project.revision }),
  renameWireframeVersion: (project: Project, flowVersionId: string, wireframeVersionId: string, name: string) => request<Project>(`/projects/${project.id}/flow-versions/${flowVersionId}/wireframe-versions/${wireframeVersionId}`, 'PATCH', { name, expectedRevision: project.revision }),
  archiveFlowGroup: (project: Project, groupId: string, archived: boolean) => request<Project>(`/projects/${project.id}/flow-groups/${groupId}/${archived ? 'archive' : 'restore'}`, 'POST', { expectedRevision: project.revision }),
  archiveFlowVersion: (project: Project, versionId: string, archived: boolean) => request<Project>(`/projects/${project.id}/flow-versions/${versionId}/${archived ? 'archive' : 'restore'}`, 'POST', { expectedRevision: project.revision }),
  archiveWireframeVersion: (project: Project, flowVersionId: string, wireframeVersionId: string, archived: boolean) => request<Project>(`/projects/${project.id}/flow-versions/${flowVersionId}/wireframe-versions/${wireframeVersionId}/${archived ? 'archive' : 'restore'}`, 'POST', { expectedRevision: project.revision }),
};
export async function download(path: string, fallback: string) {
  const response = await fetch(`/api${path}`);
  if (!response.ok) throw new Error((await response.json()).error || '파일을 만들지 못했습니다.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url;
  const encoded = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  link.download = encoded ? decodeURIComponent(encoded) : fallback; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
