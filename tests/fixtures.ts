import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import type { Artifact, Project, Feature, WireScreen } from '../shared/schema.js';
import type { AIProvider, GenerationInput } from '../server/provider.js';

export const API = 'http://127.0.0.1:4311/api';
export const mutationHeaders = { 'Content-Type': 'application/json', 'X-Requested-With': 'ProjectManager' };
export const LIBRARY_NAME = '동네 도서관 예약 서비스';
export const CANCEL_POLICY = '예약 취소는 수령 예정일 전날까지 가능합니다.';

export function libraryArtifacts(project: Project): Pick<Project, Artifact> {
  const id = (key: string) => `${project.id}-${key}`;
  const makeFeature = (key: string, title: string, kind: Feature['kind'], parentId: string | null): Feature => ({
    id: id(key), revision: 0, kind, parentId, title, description: '도서관 회원이 도서를 검색하고 예약합니다.', priority: 'high', status: 'planned', roles: ['회원'], acceptanceCriteria: [CANCEL_POLICY], prdIds: [id('prd')], favorite: false,
  });
  const screen = (key: string, name: string, target: string | null): WireScreen => ({
    id: id(`screen-${key}`), revision: 0, flowNodeId: id(`page-${key}`), flowRevision: project.artifactRevisions.flow,
    name, device: 'desktop', elements: [
      { id: id(`heading-${key}`), type: 'heading', text: name, targetScreenId: null },
      { id: id(`text-${key}`), type: 'text', text: CANCEL_POLICY, targetScreenId: null },
      { id: id(`button-${key}`), type: 'button', text: target ? '도서 상세 보기' : '예약하기', targetScreenId: target ? id(`screen-${target}`) : null },
    ],
  });
  return {
    prd: [{ id: id('prd'), revision: 0, section: 'overview', title: '서비스 소개', content: '<p>도서관 회원을 위한 도서 검색 및 예약 서비스입니다.</p>' }],
    features: [makeFeature('requirement', '도서 예약', 'requirement', null), makeFeature('feature', '도서 검색', 'feature', id('requirement')), makeFeature('subfeature', '제목 검색', 'subfeature', id('feature'))],
    flow: { nodes: [
      { id: id('start'), type: 'start', label: '시작', description: '', position: { x: 0, y: 0 }, featureIds: [], sectionId: null },
      { id: id('page-search'), type: 'page', label: '도서 검색', description: '검색어로 도서를 찾습니다.', position: { x: 240, y: 0 }, featureIds: [id('feature')], sectionId: null },
      { id: id('page-detail'), type: 'page', label: '도서 상세', description: '도서 정보와 예약 상태를 확인합니다.', position: { x: 480, y: 0 }, featureIds: [id('requirement')], sectionId: null },
    ], edges: [{ id: id('edge-1'), source: id('start'), target: id('page-search'), label: '' }, { id: id('edge-2'), source: id('page-search'), target: id('page-detail'), label: '도서 선택' }], sections: [] },
    wireframes: [screen('search', '도서 검색', 'detail'), screen('detail', '도서 상세', null)],
  };
}

export const fixtureProvider: AIProvider = {
  model: 'qa-fixture-only', configured: true,
  async generate(input: GenerationInput) {
    const { artifact, request, project, entityIds, pageTask } = JSON.parse(input.prompt) as { artifact: Artifact; request: string; project: Project; entityIds: string[]; pageTask?: { id: string; pageId: string | null; screenIds: string[]; label: string; attempt: number } };
    if (pageTask) {
      const target = pageTask.pageId || pageTask.screenIds[0];
      if (request.includes(`[QA_PAGE_DELAY:${target}]`)) await new Promise(resolve => setTimeout(resolve, 2400));
      if (request.includes(`[QA_FAIL_ALWAYS:${target}]`) || (request.includes(`[QA_FAIL_ONCE:${target}]`) && pageTask.attempt === 1)) throw new Error('검수용 단일 화면 공급자 실패');
      if (request.includes(`[QA_INVALID_PAGE:${target}]`)) return { summary: '검수용 잘못된 단일 화면', document: [{ unexpected: true }] };
      if (request.includes(`[QA_WRONG_PAGE:${target}]`)) return { summary: '선택 범위 밖 화면', document: [project.wireframes.find(screen => !pageTask.screenIds.includes(screen.id))] };
    }
    if (request.includes('[QA_DELAY]') || request.includes('선택한 와이어프레임 화면을 개선해 주세요.')) {
      // Deliberately returns after cancellation to exercise the server's late-result guard.
      await new Promise(resolve => setTimeout(resolve, 1600));
    }
    if (request.includes('[QA_INVALID]')) return { summary: '잘못된 공급자 응답', document: [{ unexpected: true }] };
    if (request.includes('[QA_FAILURE]')) throw new Error('테스트 공급자 연결 실패');
    const values = libraryArtifacts(project);
    let document: Project[Artifact] = values[artifact];
    if (artifact === 'prd') {
      const existing = project.prd[0];
      document = existing ? project.prd.map(item => item.id === existing.id ? { ...item, content: '<p>AI가 제안한 예약 서비스 개요입니다.</p>' } : item) : values.prd;
    }
    if (artifact === 'flow') {
      if (request.includes('[QA_NEW_GROUP_CONTEXT]')) {
        if (project.flow.nodes.length || project.flow.edges.length || project.flow.sections.length || project.wireframes.length || project.flowGroups !== undefined || !project.prd.length || !project.features.length) throw new Error('QA: new group received incorrect model context');
      }
      if (request.includes('[QA_NEW_VERSION_CONTEXT]')) {
        if (!project.flow.nodes.length || project.wireframes.length || project.flowGroups !== undefined) throw new Error('QA: new version received incorrect source context');
      }
      if (request.includes('[QA_SAME_FLOW]')) document = project.flow;
      if (request.includes('[QA_FRESH_FLOW]')) {
        const rename = (id: string) => `fresh-${id}`;
        document = {
          ...values.flow,
          nodes: values.flow.nodes.map(node => ({ ...node, id: rename(node.id), label: `새 ${node.label}` })),
          edges: values.flow.edges.map(edge => ({ ...edge, id: rename(edge.id), source: rename(edge.source), target: rename(edge.target) })),
        };
      }
    }
    if (artifact === 'wireframes' && request.includes('[QA_MISSING_SCREENS]')) {
      document = project.flow.nodes.filter(node => node.type === 'page' && entityIds.includes(node.id)).map(node => ({
        id: `generated-${node.id}`, revision: 0, flowNodeId: node.id, flowRevision: project.artifactRevisions.flow,
        name: node.label, device: 'desktop' as const,
        elements: [{ id: `heading-${node.id}`, type: 'heading' as const, text: `${node.label} 생성 화면`, targetScreenId: null }],
      }));
    } else if (artifact === 'wireframes' && project.wireframes.length) {
      document = project.wireframes.filter(screen => !entityIds.length || entityIds.includes(screen.id) || (screen.flowNodeId && entityIds.includes(screen.flowNodeId))).map(screen => ({
        ...screen, elements: screen.elements.map((element, index) => index === 0 ? { ...element, text: 'AI가 수정한 화면 제목' } : element),
      }));
    }
    if (artifact === 'wireframes' && request.includes('[QA_STREAM_SCREENS]') && Array.isArray(document) && document.length > 1) {
      input.onDelta(`{"summary":"단계별 화면 데이터","document":[${JSON.stringify(document[0])},`);
      await new Promise(resolve => setTimeout(resolve, 2500));
      input.onDelta(`${document.slice(1).map(screen => JSON.stringify(screen)).join(',')}]}`);
    } else input.onDelta(JSON.stringify({ summary: '도서관 요구사항을 반영한 변경안', document }));
    return { summary: '도서관 요구사항을 반영한 변경안', document };
  },
};

export async function createProject(request: APIRequestContext, name = LIBRARY_NAME): Promise<Project> {
  const response = await request.post(`${API}/projects`, { headers: mutationHeaders, data: { name: `${name} ${randomUUID().slice(0, 8)}`, description: '독립 QA 프로젝트' } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function saveArtifact(request: APIRequestContext, project: Project, artifact: Artifact, value: Project[Artifact]): Promise<Project> {
  const response = await request.put(`${API}/projects/${project.id}/artifacts/${artifact}`, {
      headers: mutationHeaders, data: { expectedRevision: project.artifactRevisions[artifact], value, label: `QA ${artifact}`, ...(['flow', 'wireframes'].includes(artifact) ? { flowVersionId: project.selectedFlowVersionId } : {}), ...(artifact === 'wireframes' ? { wireframeVersionId: project.selectedWireframeVersionId } : {}) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function seedProject(request: APIRequestContext): Promise<Project> {
  let project = await createProject(request);
  for (const artifact of ['prd', 'features', 'flow', 'wireframes'] as const) {
    project = await saveArtifact(request, project, artifact, libraryArtifacts(project)[artifact]);
  }
  return project;
}
