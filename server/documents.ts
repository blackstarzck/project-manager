import { randomUUID } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { projectSchema, type Artifact, type Project, type FlowVersion, type FlowDocument, type WireScreen, type WireElement, type WireframeVersion } from '../shared/schema.js';
import { assert } from './errors.js';
import { navigationIssues } from '../shared/wireframe-navigation.js';

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const withoutRevision = (item: Record<string, unknown>) => { const { revision: _, ...rest } = item; return rest; };
export function cleanContent(content: string) {
  if (!/<\/?[a-z][\s\S]*>/i.test(content)) return `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`;
  return sanitizeHtml(content, { allowedTags: ['p','br','strong','em','u','s','h1','h2','h3','h4','ul','ol','li','blockquote','pre','code','a','hr'], allowedAttributes: { a: ['href','title','target','rel'] }, allowedSchemes: ['https','http','mailto'], transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) } });
}
export function escapeHtml(text: string) { return text.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]!)); }

export function guardWireTrees(screens: unknown) {
  if (!Array.isArray(screens)) return;
  for (const screen of screens) {
    if (!screen || typeof screen !== 'object' || !Array.isArray(screen.elements)) continue;
    const stack = screen.elements.map((element:unknown)=>({element,depth:1}));
    const visited=new Set<unknown>();let count=0;
    while(stack.length){
      const {element,depth}=stack.pop()!;
      assert(depth<=8 && ++count<=500,'WIRE_TREE_LIMIT','화면 요소는 최대 8단계, 화면당 500개까지 사용할 수 있습니다.');
      assert(!visited.has(element),'WIRE_TREE_CYCLE','화면 요소에 순환 참조가 있습니다.');visited.add(element);
      if(element && typeof element==='object' && Array.isArray((element as {children?:unknown}).children)) for(const child of (element as {children:unknown[]}).children)stack.push({element:child,depth:depth+1});
    }
  }
}
export function wireElements(elements: WireElement[]): WireElement[] {
  const output:WireElement[]=[];const stack=[...elements].reverse();
  while(stack.length){const element=stack.pop()!;output.push(element);if(element.children)stack.push(...[...element.children].reverse());}return output;
}
export function selectedVersion(project: Project): FlowVersion {
  const version=project.flowGroups.flatMap(group=>group.versions).find(version=>version.id===project.selectedFlowVersionId);
  assert(version,'FLOW_VERSION_NOT_FOUND','선택한 플로우 버전이 없습니다.',404);return version;
}
export function selectedWireframeVersion(project:Project):WireframeVersion {
  const version=selectedVersion(project).wireframeVersions.find(version=>version.id===project.selectedWireframeVersionId);
  assert(version,'WIREFRAME_VERSION_NOT_FOUND','선택한 와이어프레임 버전이 없습니다.',404);return version;
}
export function initialWireframeVersion(flowVersionId:string,wireframes:WireScreen[]=[],revision=0,timestamp=now()):WireframeVersion {
  return {id:uid(),flowVersionId,name:'첫 번째 화면 버전',number:1,createdAt:timestamp,updatedAt:timestamp,archivedAt:null,revision:0,wireframeRevision:revision,wireframes:structuredClone(wireframes)};
}
export function syncSelectedVersion(project:Project) {
  const version=selectedVersion(project);
  version.flow=structuredClone(project.flow);version.wireframes=structuredClone(project.wireframes);
  version.flowRevision=project.artifactRevisions.flow;version.wireframeRevision=project.artifactRevisions.wireframes;
  version.selectedWireframeVersionId=project.selectedWireframeVersionId;
  const wireframe=selectedWireframeVersion(project);wireframe.wireframes=structuredClone(project.wireframes);wireframe.wireframeRevision=project.artifactRevisions.wireframes;
}
export function projectWithVersion(project:Project,versionId:string) {
  const next=structuredClone(project);next.selectedFlowVersionId=versionId;
  const version=selectedVersion(next);next.selectedWireframeVersionId=version.selectedWireframeVersionId;const wireframe=selectedWireframeVersion(next);
  next.flow=structuredClone(version.flow);next.wireframes=structuredClone(wireframe.wireframes);
  next.artifactRevisions.flow=version.flowRevision;next.artifactRevisions.wireframes=wireframe.wireframeRevision;
  return next;
}
export function projectWithWireframeVersion(project:Project,flowVersionId:string,wireframeVersionId:string){
  const next=structuredClone(project);const flow=next.flowGroups.flatMap(group=>group.versions).find(version=>version.id===flowVersionId);
  assert(flow,'FLOW_VERSION_NOT_FOUND','플로우 버전이 없습니다.',404);assert(flow.wireframeVersions.some(version=>version.id===wireframeVersionId),'WIREFRAME_VERSION_NOT_FOUND','와이어프레임 버전이 없습니다.',404);
  flow.selectedWireframeVersionId=wireframeVersionId;return projectWithVersion(next,flow.id);
}

export function validateProject(input: unknown): Project {
  const raw=input as {wireframes?:unknown;flowGroups?:{versions?:{wireframes?:unknown;wireframeVersions?:{wireframes?:unknown}[]}[]}[]};
  guardWireTrees(raw?.wireframes);
  if(Array.isArray(raw?.flowGroups))for(const group of raw.flowGroups)if(Array.isArray(group?.versions))for(const version of group.versions){guardWireTrees(version?.wireframes);if(Array.isArray(version?.wireframeVersions))for(const wireframe of version.wireframeVersions)guardWireTrees(wireframe?.wireframes);}
  const p = projectSchema.parse(input);
  if(!p.flowGroups.length){
    const groupId=uid(),versionId=uid();
    p.flowGroups=[{id:groupId,name:'기본 플로우',createdAt:p.createdAt,archivedAt:null,versions:[{id:versionId,groupId,name:'첫 번째 버전',number:1,createdAt:p.createdAt,updatedAt:p.updatedAt,archivedAt:null,revision:0,flowRevision:p.artifactRevisions.flow,wireframeRevision:p.artifactRevisions.wireframes,flow:structuredClone(p.flow),wireframes:structuredClone(p.wireframes),wireframeVersions:[],selectedWireframeVersionId:null}]}];
    p.selectedFlowVersionId=versionId;
    p.selectedWireframeVersionId=null;
  }
  assert(p.selectedFlowVersionId,'FLOW_VERSION_REQUIRED','선택한 플로우 버전이 필요합니다.');
  for(const group of p.flowGroups)for(const version of group.versions){
    if(!version.wireframeVersions.length){const first=initialWireframeVersion(version.id,version.wireframes,version.wireframeRevision,version.createdAt);version.wireframeVersions=[first];version.selectedWireframeVersionId=first.id;}
    if(!version.selectedWireframeVersionId)version.selectedWireframeVersionId=version.wireframeVersions.find(item=>!item.archivedAt)?.id||null;
    const selected=version.wireframeVersions.find(item=>item.id===version.selectedWireframeVersionId);
    assert(selected,'WIREFRAME_VERSION_NOT_FOUND','선택한 와이어프레임 버전이 없습니다.');
    assert(!selected.archivedAt,'VERSION_ARCHIVED','선택한 화면 버전은 활성 상태여야 합니다.',409);
    if(version.id!==p.selectedFlowVersionId){version.wireframes=structuredClone(selected.wireframes);version.wireframeRevision=selected.wireframeRevision;}
  }
  const activeFlow=selectedVersion(p);if(!p.selectedWireframeVersionId)p.selectedWireframeVersionId=activeFlow.selectedWireframeVersionId;
  assert(!activeFlow.archivedAt&&!p.flowGroups.find(group=>group.id===activeFlow.groupId)?.archivedAt,'VERSION_ARCHIVED','선택한 플로우 그룹과 버전은 활성 상태여야 합니다.',409);
  assert(p.selectedWireframeVersionId===activeFlow.selectedWireframeVersionId,'WIREFRAME_CONTEXT_CONFLICT','플로우와 화면 버전 선택이 일치하지 않습니다.',409);
  syncSelectedVersion(p);
  p.prd = p.prd.map(item => ({ ...item, content: cleanContent(item.content) }));
  const unique = (ids: string[], message: string) => assert(new Set(ids).size === ids.length, 'DUPLICATE_ID', message);
  unique(p.prd.map(item => item.id), 'PRD 항목 ID가 중복됩니다.');
  unique(p.features.map(item => item.id), '기능 ID가 중복됩니다.');
  unique(p.flowGroups.map(group=>group.id),'플로우 그룹 ID가 중복됩니다.');
  unique(p.flowGroups.flatMap(group=>group.versions.map(version=>version.id)),'플로우 버전 ID가 중복됩니다.');
  unique(p.flowGroups.flatMap(group=>group.versions.flatMap(version=>version.wireframeVersions.map(item=>item.id))),'와이어프레임 버전 ID가 중복됩니다.');
  const prdIds = new Set(p.prd.map(item => item.id));
  const features = new Map(p.features.map(item => [item.id, item]));
  for (const feature of p.features) {
    assert(feature.prdIds.every(id => prdIds.has(id)), 'INVALID_REFERENCE', '기능에서 참조하는 PRD 항목이 없습니다. 연결을 먼저 수정해 주세요.');
    if (feature.kind === 'requirement') assert(feature.parentId === null, 'INVALID_HIERARCHY', '요구사항에는 상위 기능을 지정할 수 없습니다.');
    else {
      const parent = feature.parentId && features.get(feature.parentId);
      assert(parent && parent.kind === (feature.kind === 'feature' ? 'requirement' : 'feature'), 'INVALID_HIERARCHY', '요구사항 → 기능 → 하위 기능 순서로 연결해 주세요.');
    }
  }
  const validateVisuals=(flow:FlowDocument,wireframes:WireScreen[],label:string)=>{
    const issues=navigationIssues(wireframes);assert(!issues.length,'INVALID_NAVIGATION',issues[0]||'공통 내비게이션 연결이 올바르지 않습니다.');
    unique(flow.nodes.map(item=>item.id),'플로우 노드 ID가 중복됩니다.');unique(flow.edges.map(item=>item.id),'플로우 연결 ID가 중복됩니다.');unique(flow.sections.map(item=>item.id),'플로우 섹션 ID가 중복됩니다.');unique(wireframes.map(item=>item.id),'화면 ID가 중복됩니다.');
    const nodes=new Map(flow.nodes.map(item=>[item.id,item]));const sections=new Set(flow.sections.map(item=>item.id));const screens=new Set(wireframes.map(item=>item.id));
    for(const node of flow.nodes){assert(node.featureIds.every(id=>features.has(id)),'INVALID_REFERENCE',`${label}에서 참조하는 기능이 없습니다. 해당 버전의 연결을 먼저 수정해 주세요.`);assert(node.sectionId===null||sections.has(node.sectionId),'INVALID_REFERENCE','플로우 섹션이 없습니다.');}
    for(const edge of flow.edges)assert(nodes.has(edge.source)&&nodes.has(edge.target),'INVALID_REFERENCE','플로우 연결의 시작 또는 도착 노드가 없습니다.');
    for(const screen of wireframes){
      assert(screen.flowNodeId===null||nodes.get(screen.flowNodeId)?.type==='page','INVALID_REFERENCE',`${label}의 와이어프레임과 연결된 페이지 노드가 없습니다. 먼저 화면 연결을 수정해 주세요.`);
      const elements=wireElements(screen.elements);unique(elements.map(item=>item.id),'화면 요소 ID가 중복됩니다.');const elementMap=new Map(elements.map(item=>[item.id,item]));
      for(const element of elements){
        assert(element.targetScreenId===null||screens.has(element.targetScreenId),'INVALID_REFERENCE','같은 플로우 버전에 이동 대상 화면이 없습니다. 화면 링크를 먼저 수정해 주세요.');
        if(element.action==='openModal'&&element.targetElementId)assert(elementMap.get(element.targetElementId)?.type==='modal','INVALID_REFERENCE','같은 화면의 모달을 이동 대상으로 지정해 주세요.');
        if(element.targetElementId)assert(elementMap.get(element.targetElementId)?.type==='modal','INVALID_REFERENCE','모달 대상 요소가 없습니다.');
        if(element.children?.length)assert(['card','row','column','grid','box','header','sidebar','body','footer','modal'].includes(element.type),'INVALID_CHILDREN','컨테이너 요소에만 하위 요소를 추가할 수 있습니다.');
        if(element.type==='table'&&element.columns?.length&&element.rows)assert(element.rows.every(row=>row.length<=element.columns!.length),'INVALID_TABLE','표의 행에 열 수보다 많은 셀이 있습니다.');
      }
    }
  };
  for(const group of p.flowGroups){
    assert(group.versions.some(version=>!version.archivedAt),'LAST_ACTIVE_VERSION','모든 그룹에 활성 플로우 버전이 하나 이상 필요합니다.',409);
    unique(group.versions.map(version=>String(version.number)),'그룹 내 버전 번호가 중복됩니다.');
    for(const version of group.versions){
      assert(version.groupId===group.id,'INVALID_REFERENCE','플로우 버전의 그룹 참조가 올바르지 않습니다.');
      unique(version.wireframeVersions.map(item=>String(item.number)),'플로우 내 화면 버전 번호가 중복됩니다.');
      for(const wireframe of version.wireframeVersions){assert(wireframe.flowVersionId===version.id,'INVALID_REFERENCE','와이어프레임 버전의 플로우 참조가 올바르지 않습니다.');validateVisuals(version.flow,wireframe.wireframes,`${group.name} / ${version.name} / ${wireframe.name}`);}
    }
  }
  return p;
}

export function newProject(name: string, description = ''): Project {
  const time = now();
  return validateProject({ id: uid(), workspaceId: 'local', name, description, createdAt: time, updatedAt: time, archivedAt: null, revision: 0, artifactRevisions: { prd:0, features:0, flow:0, wireframes:0 }, prd:[], features:[], flow:{nodes:[],edges:[],sections:[]}, wireframes:[], settings:{roles:[], devices:['desktop'],glossary:'',rules:''} });
}

export function assignEntityRevisions(previous: Project, updated: Project, artifact: Artifact, highWater: (artifact: Artifact, id: string) => number) {
  if (artifact === 'flow') return;
  const old = new Map((previous[artifact] as {id:string;revision:number}[]).map(item => [item.id, item]));
  for (const item of updated[artifact] as {id:string;revision:number}[]) {
    const prior = old.get(item.id);
    item.revision = prior && equal(withoutRevision(prior), withoutRevision(item)) ? prior.revision : Math.max(prior?.revision || 0, highWater(artifact, item.id)) + 1;
  }
}

export function cloneProject(source: Project, name = `${source.name} 복사본`) {
  const p = validateProject(structuredClone(source));
  const ids = new Map<string,string>();
  const mapped = (id: string) => { if (!ids.has(id)) ids.set(id, uid()); return ids.get(id)!; };
  const nullable = (id: string | null) => id === null ? null : mapped(id);
  p.id = uid(); p.workspaceId = 'local'; p.name = name.slice(0,120); p.createdAt = now(); p.updatedAt = p.createdAt; p.archivedAt = null; p.revision = 0;
  p.artifactRevisions = {prd:0,features:0,flow:0,wireframes:0};
  p.prd = p.prd.map(item => ({...item,id:mapped(item.id),revision:0}));
  p.features = p.features.map(item => ({...item,id:mapped(item.id),revision:0,parentId:nullable(item.parentId),prdIds:item.prdIds.map(mapped)}));
  const remapElement=(element:WireElement):WireElement=>({...element,id:mapped(element.id),targetScreenId:nullable(element.targetScreenId),...(element.targetElementId!==undefined?{targetElementId:nullable(element.targetElementId)}:{}),...(element.children?{children:element.children.map(remapElement)}:{})});
  p.flowGroups=p.flowGroups.map(group=>({...group,id:mapped(group.id),versions:group.versions.map(version=>{
    const flowRevision=version.flow.nodes.length?1:0;
    const screens=(items:WireScreen[])=>items.map(item=>({...item,id:mapped(item.id),revision:0,flowNodeId:nullable(item.flowNodeId),flowRevision:item.flowRevision===version.flowRevision?flowRevision:flowRevision===0?1:0,elements:item.elements.map(remapElement),...(item.navigationSync?{navigationSync:Object.fromEntries(Object.entries(item.navigationSync).filter(([,binding])=>binding).map(([region,binding])=>[region,{sourceScreenId:mapped(binding!.sourceScreenId),sourceElementId:mapped(binding!.sourceElementId),elementIdMap:Object.fromEntries(Object.entries(binding!.elementIdMap).map(([source,target])=>[mapped(source),mapped(target)]))}]))}:{})}));
    return {...version,id:mapped(version.id),groupId:mapped(group.id),revision:0,flowRevision,wireframeRevision:0,selectedWireframeVersionId:nullable(version.selectedWireframeVersionId),wireframeVersions:version.wireframeVersions.map(wireframe=>({...wireframe,id:mapped(wireframe.id),flowVersionId:mapped(version.id),revision:0,wireframeRevision:0,wireframes:screens(wireframe.wireframes)})),flow:{nodes:version.flow.nodes.map(item=>({...item,id:mapped(item.id),sectionId:nullable(item.sectionId),featureIds:item.featureIds.map(mapped)})),edges:version.flow.edges.map(item=>({...item,id:mapped(item.id),source:mapped(item.source),target:mapped(item.target)})),sections:version.flow.sections.map(item=>({...item,id:mapped(item.id)}))},wireframes:screens(version.wireframes)};
  })}));
  p.selectedFlowVersionId=mapped(p.selectedFlowVersionId!);
  return validateProject(projectWithVersion(p,p.selectedFlowVersionId));
}
