import type { APIRequestContext } from '@playwright/test';
import type { Project, WireElement, WireScreen } from '../shared/schema.js';
import { saveArtifact } from './fixtures.js';
import { seedThreePageProject } from './phase5-fixtures.js';

/** Equal navigation semantics with deliberately different IDs and independent body content. */
export function inferenceScreens(project: Project): WireScreen[] {
  const sourceId = project.wireframes[0].id;
  const base = [...project.wireframes.slice(0, 3), { ...project.wireframes[0], id: `${project.id}-mobile-nav`, name: '모바일 도서관', device: 'mobile' as const, flowNodeId: null, revision: 0 }];
  return base.map((screen, index) => {
    const id = (key: string) => `${screen.id}-infer-${key}`;
    const element = (key: string, type: WireElement['type'], text: string, extra: Partial<WireElement> = {}): WireElement => ({ id: id(key), type, text, targetScreenId: null, ...extra });
    return { ...screen, navigationSync: undefined, elements: [
      element('header', 'header', '', { style: index === 1 ? { gap: 8, padding: 16, background: '#f8f7ff' } : { background: '#f8f7ff', padding: 16, gap: 8 }, children: [
        element('brand', 'heading', '우리 동네 도서관'),
        element('home', 'nav', '도서 검색', { action: 'navigate', targetScreenId: sourceId }),
        element('open-help', 'button', '이용 안내 열기', { action: 'openModal', targetElementId: id('header-modal') }),
        element('header-modal', 'modal', '공통 이용 안내', { children: [element('modal-copy', 'text', '회원증을 준비해 주세요.'), element('close-help', 'button', '안내 닫기', { action: 'closeModal' })] }),
      ] }),
      element('layout', 'row', '', { children: [
        element('sidebar', 'sidebar', '', { style: { width: 180 }, children: [element('menu-title', 'text', '회원 메뉴'), element('menu-home', 'nav', '도서 검색', { action: 'navigate', targetScreenId: sourceId })] }),
        element('body', 'body', '', { children: [element('page-title', 'heading', screen.name), element('body-copy', 'text', `개별 본문 ${index + 1}: 수동으로 입력한 예약 정책`), element('body-open-help', 'button', '본문에서 안내 열기', { action: 'openModal', targetElementId: id('header-modal') })] }),
      ] }),
      element('footer', 'footer', '도서관 운영 09:00–18:00', { style: { padding: 12 } }),
    ] };
  });
}

export async function seedInferenceProject(request: APIRequestContext): Promise<Project> {
  const project = await seedThreePageProject(request);
  return saveArtifact(request, project, 'wireframes', inferenceScreens(project));
}
