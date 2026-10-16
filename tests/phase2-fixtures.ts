import { expect, type APIRequestContext } from '@playwright/test';
import type { Project, WireElement, WireScreen } from '../shared/schema.js';
import { API, mutationHeaders, saveArtifact, seedProject } from './fixtures.js';

/** Independent fixture: exercises every new container and action without AI or original user data. */
export function nestedScreens(project: Project): WireScreen[] {
  const [search, detail] = project.wireframes;
  if (!search || !detail) throw new Error('Nested fixture requires the two library screens');
  const id = (key: string) => `${project.id}-nested-${key}`;
  const element = (key: string, type: WireElement['type'], text: string, extras: Partial<WireElement> = {}): WireElement => ({ id: id(key), type, text, targetScreenId: null, ...extras });
  return [
    { ...search, elements: [
      element('header', 'header', '', { children: [element('title', 'heading', '우리 동네 도서관'), element('header-nav', 'nav', '도서 상세 이동', { action: 'navigate', targetScreenId: detail.id })] }),
      element('layout', 'row', '', { style: { gap: 16, align: 'start' }, children: [
        element('sidebar', 'sidebar', '', { style: { width: 180 }, children: [element('sidebar-title', 'text', '회원 메뉴')] }),
        element('body', 'body', '', { children: [element('column', 'column', '', { style: { gap: 12 }, children: [
          element('grid', 'grid', '', { style: { columns: 2, gap: 12 }, children: [
            element('box', 'box', '', { style: { padding: 12, background: '#f2f3f4' }, children: [element('nested-title', 'heading', '깊은 계층의 추천 도서'), element('nested-link', 'button', '중첩 도서 상세', { action: 'navigate', targetScreenId: detail.id })] }),
            element('card', 'card', '', { children: [element('open', 'button', '예약 안내 열기', { action: 'openModal', targetElementId: id('modal') })] }),
          ] }),
          element('table', 'table', '', { columns: ['도서명', '예약 상태'], rows: [['모두의 도서관', '예약 가능'], ['작은 숲', '대기 2명']] }),
          element('spacer', 'spacer', '', { style: { height: 16 } }),
        ] })] }),
      ] }),
      element('footer', 'footer', '', { children: [element('footer-text', 'text', '운영 시간 09:00–18:00')] }),
      element('modal', 'modal', '예약 안내', { children: [element('modal-text', 'text', '예약은 1인당 세 권까지 가능합니다.'), element('close', 'button', '안내 닫기', { action: 'closeModal', targetElementId: id('modal') })] }),
    ] },
    { ...detail, elements: [
      element('detail-container-header', 'header', '도서 정보 안내'),
      element('detail-layout', 'row', '', { children: [
        element('detail-sidebar', 'sidebar', '사서 도움말'),
        element('detail-body', 'body', '', { children: [element('detail-header', 'heading', '도서 상세 페이지'), element('detail-manual', 'text', '선택하지 않은 화면의 수동 편집')] }),
      ] }),
      element('back', 'button', '검색으로 돌아가기', { action: 'back' }),
    ] },
  ];
}

export function flattenElements(elements: WireElement[]): WireElement[] {
  return elements.flatMap(element => [element, ...flattenElements(element.children ?? [])]);
}

export async function seedNestedProject(request: APIRequestContext): Promise<Project> {
  const project = await seedProject(request);
  return saveArtifact(request, project, 'wireframes', nestedScreens(project));
}

export async function getProject(request: APIRequestContext, id: string): Promise<Project> {
  const response = await request.get(`${API}/projects/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function addFlowVersion(request: APIRequestContext, project: Project, options: { copy?: boolean; group?: boolean; name?: string } = {}): Promise<Project> {
  const group = project.flowGroups.find(candidate => candidate.versions.some(version => version.id === project.selectedFlowVersionId));
  if (!group) throw new Error('Current flow version has no group');
  const endpoint = options.group ? 'flow-groups' : `flow-groups/${group.id}/versions`;
  const response = await request.post(`${API}/projects/${project.id}/${endpoint}`, { headers: mutationHeaders, data: {
    name: options.name ?? (options.group ? '별도 관리자 흐름' : '두 번째 기획'), expectedRevision: project.revision,
    ...(options.copy ? { sourceVersionId: project.selectedFlowVersionId } : {}),
  } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function selectFlowVersion(request: APIRequestContext, project: Project, versionId: string): Promise<Project> {
  const response = await request.post(`${API}/projects/${project.id}/flow-versions/${versionId}/select`, { headers: mutationHeaders, data: { expectedRevision: project.revision } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
