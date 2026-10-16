import type { Artifact } from '../shared/schema';

export type WorkspaceRoute = { projectId: string; artifact: Artifact } | null;
const artifacts: Artifact[] = ['prd', 'features', 'flow', 'wireframes'];

export function readWorkspaceRoute(hash: string): WorkspaceRoute {
  const match = hash.match(/^#project\/([^/]+)(?:\/([^/]*))?\/?$/);
  if (!match) return null;
  try {
    const projectId = decodeURIComponent(match[1]);
    if (!projectId || projectId.includes('/')) return null;
    const artifact = artifacts.includes(match[2] as Artifact) ? match[2] as Artifact : 'prd';
    return { projectId, artifact };
  } catch { return null; }
}

export function workspaceHash(route: WorkspaceRoute): string {
  return route ? `#project/${encodeURIComponent(route.projectId)}/${route.artifact}` : '';
}
