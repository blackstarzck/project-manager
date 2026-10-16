import type { WireElement } from './schema';

export const containerTypes = new Set<WireElement['type']>(['row','column','grid','box','header','sidebar','body','footer','modal','card']);
export const elementLabels: Record<WireElement['type'], string> = {heading:'제목',text:'본문',button:'버튼',input:'입력 필드',card:'카드',image:'이미지 영역',nav:'내비게이션',divider:'구분선',row:'가로 배치',column:'세로 배치',grid:'그리드',box:'컨테이너',table:'표',header:'헤더',sidebar:'사이드바',body:'본문 영역',footer:'푸터',modal:'모달',spacer:'여백'};
export function flattenElements(elements: WireElement[]): WireElement[] {
  return elements.flatMap(element => [element, ...flattenElements(element.children || [])]);
}
export function treeDepth(elements: WireElement[]):number { return elements.length ? 1+Math.max(0,...elements.map(item=>treeDepth(item.children||[]))) : 0; }
export function findElement(elements: WireElement[], id: string | null): WireElement | undefined {
  if (!id) return undefined;
  for (const element of elements) { if (element.id === id) return element; const child = findElement(element.children || [], id); if (child) return child; }
}
export function updateElement(elements: WireElement[], id: string, update: (element: WireElement) => WireElement): WireElement[] {
  return elements.map(element => element.id === id ? update(element) : element.children ? {...element,children:updateElement(element.children,id,update)} : element);
}
export function removeElement(elements: WireElement[], id: string): WireElement[] {
  return elements.filter(element => element.id !== id).map(element => element.children ? {...element,children:removeElement(element.children,id)} : element);
}
export function mapElements(elements: WireElement[], update: (element: WireElement) => WireElement): WireElement[] {
  return elements.map(element => update(element.children ? {...element,children:mapElements(element.children,update)} : element));
}
export function parentOf(elements: WireElement[], id: string, parent: WireElement | null = null): WireElement | null {
  for (const element of elements) { if (element.id === id) return parent; if (findElement(element.children || [],id)) return parentOf(element.children || [],id,element); }
  return null;
}
export function moveElement(elements: WireElement[], id: string, parentId: string | null): WireElement[] {
  const element = findElement(elements,id);
  if (!element || parentId === id || findElement(element.children || [],parentId)) return elements;
  const parent = findElement(elements,parentId);
  if (parentId && (!parent || !containerTypes.has(parent.type))) return elements;
  const removed = removeElement(elements,id);
  return parentId ? updateElement(removed,parentId,item => ({...item,children:[...(item.children || []),element]})) : [...removed,element];
}
export function reorderElement(elements: WireElement[], id: string, offset: number): WireElement[] {
  const index = elements.findIndex(element => element.id === id);
  if (index >= 0) { const target = index+offset; if (target < 0 || target >= elements.length) return elements; const next = [...elements]; [next[index],next[target]]=[next[target],next[index]]; return next; }
  return elements.map(element => element.children ? {...element,children:reorderElement(element.children,id,offset)} : element);
}
export function clearElementLinks(elements: WireElement[], removedIds: Set<string>): WireElement[] {
  return mapElements(elements,element => element.targetElementId && removedIds.has(element.targetElementId) ? {...element,action:undefined,targetElementId:null} : element);
}
export function createElement(type: WireElement['type'], uid: () => string): WireElement {
  const element: WireElement = {id:uid(),type,text:({heading:'새 제목',button:'계속하기',input:'내용을 입력하세요',text:'새로운 내용을 작성하세요',card:'카드 제목\n설명을 작성해 주세요',image:'이미지',nav:'메뉴',table:'목록',modal:'안내'} as Partial<Record<WireElement['type'],string>>)[type] || '',targetScreenId:null};
  if (containerTypes.has(type)) element.children=[];
  if (['row','column','grid','body','box'].includes(type)) element.style={gap:16,padding:16};
  if (type==='grid') element.style={...element.style,columns:2};
  if (type==='sidebar') element.style={width:240,padding:24,gap:12,background:'#f5f4f1'};
  if (type==='header') element.style={height:56,padding:16,gap:16,align:'center'};
  if (type==='footer') element.style={padding:24,gap:12,background:'#f5f4f1'};
  if (type==='spacer') element.style={height:24};
  if (type==='table') { element.columns=['항목','상태']; element.rows=[['첫 번째 항목','진행 중'],['두 번째 항목','완료']]; }
  if (type==='modal') element.children=[{id:uid(),type:'heading',text:'안내',targetScreenId:null},{id:uid(),type:'text',text:'이곳에 안내 내용을 작성하세요.',targetScreenId:null},{id:uid(),type:'button',text:'닫기',targetScreenId:null,action:'closeModal'}];
  return element;
}
export function screenTemplate(name:string,device:'desktop'|'tablet'|'mobile',uid:()=>string):WireElement[] {
  const header=createElement('header',uid); header.children=[{...createElement('heading',uid),text:name,style:{fontSize:20}},{...createElement('nav',uid),text:'내 계정'}];header.style={...header.style,justify:'between',background:'#faf9f6'};
  const sidebar=createElement('sidebar',uid);sidebar.children=['홈','내 목록','설정'].map(text=>({...createElement('nav',uid),text}));
  const body=createElement('body',uid);body.style={padding:32,gap:24};body.children=[{...createElement('heading',uid),text:name},{...createElement('text',uid),text:'화면의 목적과 주요 내용을 작성하세요.'},{...createElement('card',uid),text:'콘텐츠 영역\n사용자에게 필요한 정보를 정리하세요.'},{...createElement('button',uid),text:'계속하기'}];
  const main=createElement(device==='desktop'?'row':'column',uid);main.style={gap:0,padding:0};main.children=device==='desktop'?[sidebar,body]:[body];
  return [header,main,{...createElement('footer',uid),children:[{...createElement('text',uid),text:'서비스 안내 · 문의하기'}]}];
}

