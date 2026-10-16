import type { NavigationBinding, WireElement, WireScreen } from './schema';
import { clearElementLinks, findElement, flattenElements, mapElements, treeDepth, updateElement } from './wireframe-tree';

export const navigationRegions = ['header','sidebar','footer'] as const;
export type NavigationRegion = typeof navigationRegions[number];
export const navigationRegionLabels: Record<NavigationRegion,string> = {header:'헤더',sidebar:'사이드바',footer:'푸터'};
export function screenNavigation(screen: WireScreen) {
  const found=new Map<NavigationRegion,WireElement>();
  const visit=(elements:WireElement[])=>{for(const element of elements){
    if(element.type==='modal')continue;
    if(navigationRegions.includes(element.type as NavigationRegion)){
      const type=element.type as NavigationRegion;if(!found.has(type))found.set(type,element);
    }else if(element.children)visit(element.children);
  }};
  visit(screen.elements);
  return navigationRegions.flatMap(type=>found.has(type)?[{type,element:found.get(type)!}]:[]);
}

// Copy an explicit region selection. Each screen keeps its own editable tree.
export function applyNavigation(screens: WireScreen[], sourceId: string, targetIds: string[], regions: NavigationRegion[], uid:()=>string): WireScreen[] {
  const source=screens.find(screen=>screen.id===sourceId);
  if(!source)return screens;
  const selected=screenNavigation(source).filter(region=>regions.includes(region.type));
  const screenIds=new Set(screens.map(screen=>screen.id));
  return screens.map(screen=>{
    if(screen.id===sourceId||!targetIds.includes(screen.id))return screen;
    let elements=screen.elements;
    const idMap=new Map(selected.flatMap(region=>flattenElements([region.element])).map(item=>[item.id,uid()]));
    for(const {type,element} of selected){
      const previous=screenNavigation({...screen,elements}).find(region=>region.type===type)?.element;
      const [copy]=mapElements(structuredClone([element]),item=>{
        const targetElementId=item.targetElementId ? idMap.get(item.targetElementId) || null : item.targetElementId;
        const targetScreenId=item.targetScreenId&&screenIds.has(item.targetScreenId)?item.targetScreenId:null;
        const action=(item.action==='openModal'||item.action==='closeModal')&&item.targetElementId&&!targetElementId ? undefined : item.action;
        return {...item,id:idMap.get(item.id)!,targetElementId,targetScreenId,action};
      });
      if(previous){
        const retainedIds=new Set(idMap.values());
        elements=clearElementLinks(updateElement(elements,previous.id,()=>copy),new Set(flattenElements([previous]).map(item=>item.id).filter(id=>!retainedIds.has(id))));
      }else if(type==='header')elements=[copy,...elements];
      else if(type==='footer')elements=[...elements,copy];
      else {
        const body=elements.filter(item=>!['header','footer'].includes(item.type));
        const row:WireElement={id:uid(),type:'row',text:'',targetScreenId:null,style:{gap:0,padding:0},children:[copy,{id:uid(),type:'body',text:'',targetScreenId:null,children:body}]};
        elements=[...elements.filter(item=>item.type==='header'),row,...elements.filter(item=>item.type==='footer')];
      }
    }
    const navigationSync={...screen.navigationSync};
    for(const {type} of selected)delete navigationSync[type];
    const result={...screen,elements};
    if(Object.keys(navigationSync).length)result.navigationSync=navigationSync;else delete result.navigationSync;
    return result;
  });
}

function withoutBinding(screen:WireScreen,region:NavigationRegion):WireScreen {
  const navigationSync={...screen.navigationSync};delete navigationSync[region];
  const next={...screen};if(Object.keys(navigationSync).length)next.navigationSync=navigationSync;else delete next.navigationSync;
  return next;
}
export function unlinkNavigation(screens:WireScreen[],screenId:string,regions:NavigationRegion[]):WireScreen[]{
  return screens.map(screen=>screen.id===screenId?regions.reduce(withoutBinding,screen):screen);
}
export function linkedNavigationRegion(screen:WireScreen,elementId:string|null):NavigationRegion|undefined {
  if(!elementId)return;
  return navigationRegions.find(region=>Object.values(screen.navigationSync?.[region]?.elementIdMap||{}).includes(elementId));
}
function putRegion(screen:WireScreen,region:NavigationRegion,copy:WireElement,previousId:string|undefined,uid:()=>string):WireScreen {
  const previous=previousId&&findElement(screen.elements,previousId)||screenNavigation(screen).find(item=>item.type===region)?.element;
  let elements=screen.elements;
  if(previous){
    const retained=new Set(flattenElements([copy]).map(item=>item.id));
    elements=clearElementLinks(updateElement(elements,previous.id,()=>copy),new Set(flattenElements([previous]).map(item=>item.id).filter(id=>!retained.has(id))));
  }else if(region==='header')elements=[copy,...elements];
  else if(region==='footer')elements=[...elements,copy];
  else {
    const body=elements.filter(item=>!['header','footer'].includes(item.type));
    elements=[...elements.filter(item=>item.type==='header'),{id:uid(),type:'row',text:'',targetScreenId:null,style:{gap:0,padding:0},children:[copy,{id:uid(),type:'body',text:'',targetScreenId:null,children:body}]},...elements.filter(item=>item.type==='footer')];
  }
  return {...screen,elements};
}

/** Bind explicit page regions. A region has one source; chaining is deliberately disallowed. */
export function linkNavigation(screens:WireScreen[],sourceId:string,targetIds:string[],regions:NavigationRegion[],uid:()=>string):WireScreen[]{
  const source=screens.find(screen=>screen.id===sourceId);if(!source)return screens;
  const selected=screenNavigation(source).filter(item=>regions.includes(item.type));
  if(selected.some(item=>source.navigationSync?.[item.type]))throw new Error('다른 화면에 연결된 영역은 기준으로 사용할 수 없습니다. 먼저 연결을 해제해 주세요.');
  if(screens.some(screen=>targetIds.includes(screen.id)&&screen.device!==source.device))throw new Error('자동 동기화는 같은 기기의 화면끼리 연결해 주세요. 다른 기기는 복사만 적용할 수 있습니다.');
  const next=screens.map(screen=>{
    if(screen.id===sourceId||!targetIds.includes(screen.id))return screen;
    const missing=selected.filter(({type,element})=>screen.navigationSync?.[type]?.sourceScreenId!==sourceId||screen.navigationSync[type]?.sourceElementId!==element.id);
    const copiedScreen=missing.length?applyNavigation(screens,sourceId,[screen.id],missing.map(item=>item.type),uid).find(item=>item.id===screen.id)!:screen;
    const navigationSync={...copiedScreen.navigationSync};
    for(const {type,element} of missing){
      const copied=screenNavigation(copiedScreen).find(item=>item.type===type)!.element;
      const originals=flattenElements([element]),copies=flattenElements([copied]);
      navigationSync[type]={sourceScreenId:sourceId,sourceElementId:element.id,elementIdMap:Object.fromEntries(originals.map((item,index)=>[item.id,copies[index].id]))};
    }
    return {...copiedScreen,navigationSync};
  });
  return synchronizeNavigation(screens,next,uid);
}

export function navigationIssues(screens:WireScreen[]):string[]{
  const issues:string[]=[];
  if(screens.length>100)return ['한 화면 버전에는 화면을 100개까지 만들 수 있어요. 기존 화면은 변경하지 않았습니다.'];
  for(const screen of screens){
    const elements=flattenElements(screen.elements);
    if(screen.elements.length>100||elements.some(item=>(item.children?.length||0)>100)){issues.push('한 컨테이너 안에는 요소를 100개까지 추가할 수 있어요. 기존 화면은 변경하지 않았습니다.');continue;}
    if(elements.length>500||treeDepth(screen.elements)>8){issues.push('화면은 요소 500개, 중첩 8단계까지 구성할 수 있어요. 기존 화면은 변경하지 않았습니다.');continue;}
    const used=new Set<string>();
    for(const region of navigationRegions){
      const binding=screen.navigationSync?.[region];if(!binding)continue;
      const source=screens.find(item=>item.id===binding.sourceScreenId);
      const sourceRegion=source&&screenNavigation(source).find(item=>item.type===region&&item.element.id===binding.sourceElementId)?.element;
      if(!source||source.id===screen.id||!sourceRegion){issues.push('공통 영역의 기준 화면 또는 영역이 올바르지 않습니다.');continue;}
      if(source.device!==screen.device){issues.push('자동 동기화는 같은 기기의 화면끼리 연결해 주세요.');continue;}
      if(source.navigationSync?.[region]){issues.push('공통 영역은 연결을 여러 단계로 이어 붙일 수 없습니다. 기준 화면의 연결을 먼저 해제해 주세요.');continue;}
      const sourceElements=flattenElements([sourceRegion]),keys=Object.keys(binding.elementIdMap),ids=Object.values(binding.elementIdMap);
      if(keys.length>500||keys.length!==sourceElements.length||sourceElements.some(item=>!binding.elementIdMap[item.id]))issues.push('공통 영역의 요소 연결 정보가 올바르지 않습니다.');
      if(ids.some(id=>used.has(id))||new Set(ids).size!==ids.length)issues.push('공통 영역의 요소 연결이 중복되었습니다.');
      ids.forEach(id=>used.add(id));
      const target=findElement(screen.elements,binding.elementIdMap[binding.sourceElementId]);
      if(!target||target.type!==region||flattenElements([target]).length!==ids.length||ids.some(id=>!findElement([target],id)))issues.push('공통 영역의 대상 요소가 올바르지 않습니다.');
    }
  }
  return issues;
}

/** Materialize linked regions so editor, backups and exports share the same saved content. */
export function synchronizeNavigation(previous:WireScreen[],incoming:WireScreen[],uid:()=>string):WireScreen[]{
  let result=incoming.map(screen=>{
    let next=screen;
    for(const region of navigationRegions){
      const binding=next.navigationSync?.[region];if(!binding)continue;
      const source=incoming.find(item=>item.id===binding.sourceScreenId);
      const sourceRegion=source&&screenNavigation(source).find(item=>item.type===region&&item.element.id===binding.sourceElementId);
      if(sourceRegion&&source!.device===screen.device)continue;
      const oldScreen=previous.find(item=>item.id===screen.id),old=oldScreen?.navigationSync?.[region];
      const oldSource=previous.find(item=>item.id===binding.sourceScreenId);
      if(!old||old.sourceScreenId!==binding.sourceScreenId||old.sourceElementId!==binding.sourceElementId||!oldSource||oldSource.device!==oldScreen!.device||!screenNavigation(oldSource).some(item=>item.type===region&&item.element.id===binding.sourceElementId))throw new Error('공통 영역의 기준 화면 또는 기기 연결이 올바르지 않습니다.');
      next=withoutBinding(next,region);
    }
    return next;
  });
  result=result.map(screen=>{
    let next=screen;
    const plans:{region:NavigationRegion;binding:NavigationBinding;source:WireScreen;element:WireElement;previousId?:string}[]=[];
    const used=new Set(flattenElements(screen.elements).map(item=>item.id));
    const mapped=new Set<string>();
    const fresh=()=>{let id=uid();while(used.has(id)||mapped.has(id))id=uid();used.add(id);return id;};
    for(const region of navigationRegions){
      const binding=screen.navigationSync?.[region];if(!binding)continue;
      const source=result.find(item=>item.id===binding.sourceScreenId)!;
      if(source.id===screen.id||source.navigationSync?.[region])throw new Error('공통 영역은 연결을 여러 단계로 이어 붙일 수 없습니다. 기준 화면의 연결을 먼저 해제해 주세요.');
      const element=screenNavigation(source).find(item=>item.type===region&&item.element.id===binding.sourceElementId)!.element;
      const previousId=binding.elementIdMap[binding.sourceElementId];
      const existing=findElement(screen.elements,previousId||null);
      const allowed=new Set(existing?flattenElements([existing]).map(item=>item.id):[]);
      const elementIdMap:Record<string,string>={};
      for(const item of flattenElements([element])){
        let id=binding.elementIdMap[item.id];
        if(id&&(mapped.has(id)||(used.has(id)&&!allowed.has(id))))throw new Error('공통 영역의 요소 연결이 본문 또는 다른 영역과 겹칩니다.');
        if(!id)id=fresh();mapped.add(id);elementIdMap[item.id]=id;
      }
      plans.push({region,binding:{...binding,elementIdMap},source,element,previousId});
    }
    for(const plan of plans){
      const sharedMap=Object.assign({},...plans.filter(item=>item.source.id===plan.source.id).map(item=>item.binding.elementIdMap)) as Record<string,string>;
      const [copy]=mapElements(structuredClone([plan.element]),item=>{
        const targetElementId=item.targetElementId?sharedMap[item.targetElementId]||null:item.targetElementId;
        const targetScreenId=item.targetScreenId&&result.some(screen=>screen.id===item.targetScreenId)?item.targetScreenId:null;
        const action=(item.action==='openModal'||item.action==='closeModal')&&item.targetElementId&&!targetElementId?undefined:item.action;
        return {...item,id:plan.binding.elementIdMap[item.id],targetElementId,targetScreenId,action};
      });
      next=putRegion(next,plan.region,copy,plan.previousId,fresh);
      next={...next,navigationSync:{...next.navigationSync,[plan.region]:plan.binding}};
    }
    return next;
  });
  const issues=navigationIssues(result);if(issues.length)throw new Error(issues[0]);
  return result;
}

/** Remove a deleted source binding from undo snapshots without discarding unrelated body edits. */
export function detachNavigationHistory(snapshot:WireScreen,current:WireScreen,bindings:Partial<Record<NavigationRegion,NavigationBinding>>,uid:()=>string):WireScreen {
  let result=snapshot;
  for(const region of navigationRegions){
    const detached=bindings[region],old=result.navigationSync?.[region];
    if(!detached||!old||old.sourceScreenId!==detached.sourceScreenId||old.sourceElementId!==detached.sourceElementId)continue;
    const retained=screenNavigation(current).find(item=>item.type===region)?.element;
    if(retained)result=putRegion(result,region,structuredClone(retained),old.elementIdMap[old.sourceElementId],uid);
    result=withoutBinding(result,region);
  }
  return result;
}
