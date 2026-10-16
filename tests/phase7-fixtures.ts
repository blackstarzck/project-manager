import type { APIRequestContext } from '@playwright/test';
import type { Project, WireElement, WireScreen } from '../shared/schema.js';
import { saveArtifact } from './fixtures.js';
import { seedInferenceProject } from './phase6-fixtures.js';

export const pageHeader = (screen: WireScreen) => screen.elements.find(element => element.type === 'header')!;

/** Menu wording and navigation styling differ; non-menu copy, structure and actions stay exact. */
export async function seedSimilarNavigation(request: APIRequestContext): Promise<Project> {
  const project = await seedInferenceProject(request), screens = structuredClone(project.wireframes);
  const header = pageHeader(screens[1]);
  header.style = { ...header.style, background: '#e8f4ff', padding: 20 };
  header.children![1].text = '책 찾아보기';
  header.children![1].style = { color: '#164a78' };
  return saveArtifact(request, project, 'wireframes', screens);
}

export async function seedMissingNavigation(request: APIRequestContext): Promise<Project> {
  const project = await seedInferenceProject(request), screens = structuredClone(project.wireframes);
  screens[2].elements = screens[2].elements.filter(element => element.type !== 'header');
  const clear = (items: WireElement[]): WireElement[] => items.map(item => ({ ...item,
    ...(item.targetElementId?.endsWith('-header-modal') ? { action: undefined, targetElementId: null } : {}),
    ...(item.children ? { children: clear(item.children) } : {}),
  }));
  screens[2].elements = clear(screens[2].elements);
  return saveArtifact(request, project, 'wireframes', screens);
}

/** No page-level common regions, but every body retains a working local modal. */
export async function seedGeneratedNavigation(request: APIRequestContext): Promise<Project> {
  const project = await seedInferenceProject(request);
  const screens = project.wireframes.map((screen, index): WireScreen => {
    const id = (key: string) => `${screen.id}-generated-fixture-${key}`;
    const element = (key: string, type: WireElement['type'], text: string, extra: Partial<WireElement> = {}): WireElement => ({ id: id(key), type, text, targetScreenId: null, ...extra });
    return { ...screen, navigationSync: undefined, elements: [
      element('body', 'body', '', { children: [
        element('title', 'heading', screen.name),
        element('copy', 'text', `본문 ${index + 1}은 새 공통 영역 생성 후에도 그대로 유지됩니다.`),
        element('open', 'button', '개별 안내 열기', { action: 'openModal', targetElementId: id('modal') }),
      ] }),
      element('modal', 'modal', '개별 안내', { children: [element('modal-copy', 'text', `${screen.name} 전용 안내`), element('close', 'button', '개별 안내 닫기', { action: 'closeModal' })] }),
    ] };
  });
  return saveArtifact(request, project, 'wireframes', screens);
}

export async function seedPreviewProject(request: APIRequestContext): Promise<Project> {
  let project = await seedGeneratedNavigation(request);
  const publicId = `${project.id}-public-section`, memberId = `${project.id}-member-section`;
  project = await saveArtifact(request, project, 'flow', { ...project.flow,
    sections: [{ id: publicId, title: '도서 이용', color: '#8670ca' }, { id: memberId, title: '회원 업무', color: '#367eb0' }],
    nodes: project.flow.nodes.map(node => ({ ...node, sectionId: node.id === project.wireframes[2].flowNodeId ? memberId : node.type === 'page' ? publicId : null })),
  });
  const screens = structuredClone(project.wireframes);
  screens.forEach(screen => { screen.flowRevision = project.artifactRevisions.flow; });
  screens[0].elements[0].children!.push(...Array.from({ length: 60 }, (_, index): WireElement => ({ id: `${project.id}-long-body-${index}`, type: 'text', text: `도서관 안내 ${index + 1}: 아래쪽 내용도 화면 안에서 스크롤해 확인할 수 있습니다.`, targetScreenId: null })));
  return saveArtifact(request, project, 'wireframes', screens);
}
