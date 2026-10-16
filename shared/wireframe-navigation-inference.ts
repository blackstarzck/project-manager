import { screenSchema, type NavigationRegion, type WireElement, type WireScreen } from './schema';
import { applyNavigation, navigationIssues, navigationRegions, screenNavigation } from './wireframe-navigation';
import { flattenElements, mapElements, updateElement } from './wireframe-tree';

export type NavigationInferenceOptions = {extended?:boolean};
export type NavigationInferenceKind = 'exact'|'similar'|'missing'|'generated';
export type NavigationInferenceDifference = {elementId?:string;field:'text'|'style'|'region';before?:unknown;after?:unknown;message:string};
export type NavigationInferenceTarget = {screenId:string;kind:NavigationInferenceKind;differences:NavigationInferenceDifference[];destructive:boolean};
export type NavigationInferenceSelection = {candidateId:string;targetScreenIds:string[];allowChanges?:boolean};
export type NavigationInferenceCandidate = {
  id:string;
  kind:NavigationInferenceKind;
  region:NavigationRegion;
  device:WireScreen['device'];
  sourceScreenId:string;
  sourceElementId:string;
  targetScreenIds:string[];
  reasons:string[];
  elementIdMaps:Record<string,Record<string,string>>;
  targets:NavigationInferenceTarget[];
  sourceChanges?:NavigationInferenceDifference[];
  sourcePreview?:WireElement;
};
export type NavigationInferenceAnalysis = {
  snapshotKey:string;
  options:{extended:boolean};
  candidates:NavigationInferenceCandidate[];
  skipped:{screenId:string;region:NavigationRegion;reason:string}[];
};

type RegionInfo = {screen:WireScreen;region:NavigationRegion;element:WireElement;elements:WireElement[];signature:string;family:string;ownsFollowers:boolean};
const staleMessage='화면 내용이 바뀌었습니다. 공통 영역을 다시 분석해 주세요.';
const layoutTypes=new Set<WireElement['type']>(['header','sidebar','footer','row','column','grid','box']);
const styleValue=(item:WireElement)=>Object.fromEntries(Object.entries(item.style||{}).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b)));
function navigationBearing(item:WireElement):boolean {
  return ['nav','button'].includes(item.type)&&(
    (!!item.targetScreenId&&(!item.action||item.action==='navigate'))||item.action==='back'||
    (item.action==='openModal'&&!!item.targetElementId)||item.action==='closeModal'
  );
}
function optionsValue(options:NavigationInferenceOptions={}):{extended:boolean} {
  if(!options||typeof options!=='object'||Object.keys(options).some(key=>key!=='extended')||(options.extended!==undefined&&typeof options.extended!=='boolean'))throw new Error('공통 영역 분석 옵션이 올바르지 않습니다.');
  return {extended:options.extended===true};
}

/** Bound traversal before recursive schema/helpers, including malformed imported drafts. */
function assertInput(screens:WireScreen[]):void {
  if(screens.length>100)throw new Error('한 화면 버전에는 화면을 100개까지 분석할 수 있습니다.');
  const screenIds=new Set<string>();
  for(const screen of screens){
    if(screenIds.has(screen.id))throw new Error('화면 ID가 중복되어 공통 영역을 분석할 수 없습니다.');
    screenIds.add(screen.id);
    if(!Array.isArray(screen.elements)||screen.elements.length>100)throw new Error('화면의 요소 구조가 올바르지 않습니다.');
    const pending=screen.elements.map(element=>({element,depth:1})),ids=new Set<string>();
    let count=0;
    while(pending.length){
      const {element,depth}=pending.pop()!;
      if(++count>500||depth>8)throw new Error('공통 영역 분석은 화면당 요소 500개, 중첩 8단계까지 지원합니다.');
      if(!element||ids.has(element.id))throw new Error('화면 요소 ID가 중복되거나 구조가 올바르지 않습니다.');
      ids.add(element.id);
      if(element.children!==undefined){
        if(!Array.isArray(element.children)||element.children.length>100)throw new Error('컨테이너의 요소 구조가 올바르지 않습니다.');
        for(const child of element.children)pending.push({element:child,depth:depth+1});
      }
    }
    if(!screenSchema.safeParse(screen).success)throw new Error('화면 정보가 올바르지 않아 공통 영역을 분석할 수 없습니다.');
  }
  const issues=navigationIssues(screens);
  if(issues.length)throw new Error(issues[0]);
}

/** Match the page-level discovery rule without silently choosing a duplicate region. */
function pageRegions(elements:WireElement[]):Map<NavigationRegion,WireElement[]> {
  const found=new Map<NavigationRegion,WireElement[]>();
  const visit=(items:WireElement[])=>{for(const item of items){
    if(item.type==='modal')continue;
    if(navigationRegions.includes(item.type as NavigationRegion)){
      const region=item.type as NavigationRegion;
      found.set(region,[...(found.get(region)||[]),item]);
    }else if(item.children)visit(item.children);
  }};
  visit(elements);
  return found;
}

function hasContent(elements:WireElement[]):boolean {
  return elements.some(item=>item.text.trim()||item.targetScreenId||item.targetElementId||item.action==='back'||item.action==='closeModal'||item.columns?.some(value=>value.trim())||item.rows?.some(row=>row.some(value=>value.trim())));
}

function signature(element:WireElement,screenIds:Set<string>):{value?:string;family?:string;reason?:string} {
  const paths=new Map<string,string>(),elements=flattenElements([element]);
  const index=(item:WireElement,path:string)=>{paths.set(item.id,path);item.children?.forEach((child,position)=>index(child,`${path}.${position}`));};
  index(element,'0');
  if(!hasContent(elements))return {reason:'내용이나 동작이 없는 빈 영역은 자동으로 연결하지 않습니다.'};
  if(elements.some(item=>item.targetElementId&&!paths.has(item.targetElementId)))return {reason:'다른 영역이나 본문의 모달을 참조하여 자동 연결에서 제외했습니다.'};
  if(elements.some(item=>item.targetScreenId&&!screenIds.has(item.targetScreenId)))return {reason:'이 버전에 없는 화면을 참조하여 자동 연결에서 제외했습니다.'};
  if(elements.some(item=>item.targetElementId&&(item.action==='openModal'||item.action==='closeModal')&&elements.find(target=>target.id===item.targetElementId)?.type!=='modal'))return {reason:'모달 동작의 대상이 올바르지 않아 자동 연결에서 제외했습니다.'};
  const semantic=(item:WireElement,similar=false):unknown=>({
    type:item.type,text:similar&&navigationBearing(item)?null:item.text,targetScreenId:item.targetScreenId,action:item.action,
    targetElementId:item.targetElementId?paths.get(item.targetElementId):null,
    style:similar&&(layoutTypes.has(item.type)||navigationBearing(item))?null:styleValue(item),
    columns:item.columns,rows:item.rows,children:(item.children||[]).map(child=>semantic(child,similar)),
  });
  const value=JSON.stringify(semantic(element));
  return {value,family:elements.some(navigationBearing)?JSON.stringify(semantic(element,true)):value};
}

function differences(source:RegionInfo,target:RegionInfo):NavigationInferenceDifference[]{
  return source.elements.flatMap((element,index)=>{
    const previous=target.elements[index],changes:NavigationInferenceDifference[]=[];
    if(element.text!==previous.text)changes.push({elementId:previous.id,field:'text',before:previous.text,after:element.text,message:`메뉴 문구 “${previous.text}”를 “${element.text}”로 변경합니다.`});
    const before=styleValue(previous),after=styleValue(element);
    if(JSON.stringify(before)!==JSON.stringify(after))changes.push({elementId:previous.id,field:'style',before,after,message:`${previous.text||previous.type}의 스타일을 기준 영역에 맞춥니다.`});
    return changes;
  });
}
const kindRank:Record<NavigationInferenceKind,number>={exact:0,similar:1,missing:2,generated:3};
const candidateKind=(targets:NavigationInferenceTarget[])=>targets.reduce<NavigationInferenceKind>((kind,target)=>kindRank[target.kind]>kindRank[kind]?target.kind:kind,'exact');

/** Conservative, local-only suggestions. No copy, inference across devices, or ownership transfer. */
export function inferNavigationCandidates(screens:WireScreen[],options:NavigationInferenceOptions={}):NavigationInferenceAnalysis {
  assertInput(screens);
  const resolvedOptions=optionsValue(options);
  const analysis:NavigationInferenceAnalysis={snapshotKey:JSON.stringify(screens),options:resolvedOptions,candidates:[],skipped:[]};
  const skip=(screenId:string,region:NavigationRegion,reason:string)=>analysis.skipped.push({screenId,region,reason});
  const groups=new Map<string,RegionInfo[]>(),screenIds=new Set(screens.map(screen=>screen.id));
  const missing=new Map<string,WireScreen[]>(),eligible=screens.filter(screen=>!screen.navigationInferenceExcluded);
  for(const screen of screens){
    if(screen.navigationInferenceExcluded){for(const region of navigationRegions)skip(screen.id,region,'자동 찾기에서 제외한 화면입니다.');continue;}
    const regions=pageRegions(screen.elements);
    for(const region of navigationRegions){
      const found=regions.get(region)||[];
      if(!found.length){
        const key=JSON.stringify([screen.device,region]);missing.set(key,[...(missing.get(key)||[]),screen]);
        skip(screen.id,region,'이 화면에는 해당 공통 영역이 없습니다.');continue;
      }
      if(found.length!==1){skip(screen.id,region,'같은 종류의 영역이 여러 개여서 기준을 결정할 수 없습니다.');continue;}
      if(screen.navigationSync?.[region]){skip(screen.id,region,'이미 연결된 영역의 기준은 자동으로 변경하지 않습니다.');continue;}
      const element=found[0],result=signature(element,screenIds);
      if(result.reason){skip(screen.id,region,result.reason);continue;}
      const info:RegionInfo={screen,region,element,elements:flattenElements([element]),signature:result.value!,family:result.family!,ownsFollowers:screens.some(target=>target.navigationSync?.[region]?.sourceScreenId===screen.id&&target.navigationSync[region]?.sourceElementId===element.id)};
      const key=JSON.stringify([screen.device,region,resolvedOptions.extended?info.family:info.signature]);
      groups.set(key,[...(groups.get(key)||[]),info]);
    }
  }
  const familyCounts=new Map<string,number>();
  for(const group of groups.values()){const key=JSON.stringify([group[0].screen.device,group[0].region]);familyCounts.set(key,(familyCounts.get(key)||0)+1);}
  for(const group of groups.values()){
    const owners=group.filter(info=>info.ownsFollowers);
    if(owners.length>1){
      for(const info of group)skip(info.screen.id,info.region,'기존 연결의 기준 화면이 둘 이상이어서 자동으로 합치지 않습니다.');
      if(resolvedOptions.extended)for(const target of missing.get(JSON.stringify([group[0].screen.device,group[0].region]))||[])skip(target.id,group[0].region,'기존 연결의 기준 화면이 둘 이상이어서 없는 영역의 기준을 결정할 수 없습니다.');
      continue;
    }
    const source=owners[0]||group[0],existingTargets=group.filter(info=>info!==source);
    const regionKey=JSON.stringify([source.screen.device,source.region]);
    const missingTargets=resolvedOptions.extended&&familyCounts.get(regionKey)===1?(missing.get(regionKey)||[]):[];
    const targets:NavigationInferenceTarget[]=[
      ...existingTargets.map(target=>({screenId:target.screen.id,kind:(source.signature===target.signature?'exact':'similar') as NavigationInferenceKind,differences:source.signature===target.signature?[]:differences(source,target),destructive:source.signature!==target.signature})),
      ...missingTargets.map(target=>({screenId:target.id,kind:'missing' as const,destructive:false,differences:[{field:'region' as const,before:null,after:{type:source.region,text:source.element.text,elementCount:source.elements.length},message:`없는 ${source.region} 영역을 새 요소로 추가합니다.${source.region==='sidebar'?' 기존 본문을 레이아웃 컨테이너로 감싸며 내용과 ID는 유지합니다.':''}`}]})),
    ];
    if(!targets.length){skip(source.screen.id,source.region,'같은 기기에 내용과 동작이 일치하는 다른 영역이 없습니다.');continue;}
    analysis.candidates.push({
      // JSON tuples are injective for these strings; no lossy hash or delimiter collision.
      id:JSON.stringify([source.screen.device,source.region,source.screen.id]),
      kind:candidateKind(targets),targets,
      region:source.region,device:source.screen.device,sourceScreenId:source.screen.id,sourceElementId:source.element.id,
      targetScreenIds:targets.map(info=>info.screenId),
      reasons:[
        targets.every(target=>target.kind==='exact')?'같은 기기의 영역 구조·문구·동작·스타일이 일치합니다.':'같은 기기의 메뉴 구조와 동작을 기준으로 변경 가능한 영역을 제안합니다.',
        owners.length?'이미 연결의 기준인 화면을 유지합니다.':'화면 순서에서 첫 번째 일치 영역을 기준으로 제안합니다.',
        targets.every(target=>target.kind==='exact')?'기존 요소 ID와 본문을 유지하고 공통 영역의 연결 정보만 추가합니다.':'각 대상의 문구·스타일 변경 또는 새 영역 추가를 확인한 후 선택해 주세요. 본문 내용과 기존 요소 ID는 유지합니다.',
      ],
      elementIdMaps:Object.fromEntries(existingTargets.map(target=>[target.screen.id,Object.fromEntries(source.elements.map((item,index)=>[item.id,target.elements[index].id]))])),
      ...(missingTargets.length?{sourcePreview:structuredClone(source.element)}:{}),
    });
  }
  if(resolvedOptions.extended){
    for(const [key,targets] of missing){
      if((familyCounts.get(key)||0)>1)for(const target of targets)skip(target.id,JSON.parse(key)[1] as NavigationRegion,'기준 영역의 구조나 동작이 여러 종류여서 없는 영역을 자동으로 채우지 않습니다.');
    }
    for(const device of ['desktop','tablet','mobile'] as const){
      const deviceScreens=eligible.filter(screen=>screen.device===device);
      if(deviceScreens.length<2||deviceScreens.some(screen=>pageRegions(screen.elements).size))continue;
      const source=deviceScreens[0];
      const preview:WireElement={id:'navigation-preview-header',type:'header',text:'페이지 메뉴',targetScreenId:null,style:{gap:16,padding:16,align:'center'},children:deviceScreens.map((screen,index)=>({id:`navigation-preview-item-${index}`,type:'nav',text:screen.name,targetScreenId:screen.id,action:'navigate'}))};
      const sourceChanges:NavigationInferenceDifference[]=[{field:'region',before:null,after:{type:'header',destinations:deviceScreens.map(screen=>({screenId:screen.id,label:screen.name}))},message:'기준 화면에도 현재 화면 목록을 이동 대상으로 하는 새 헤더를 추가합니다.'}];
      const targets:NavigationInferenceTarget[]=deviceScreens.slice(1).map(screen=>({screenId:screen.id,kind:'generated',destructive:false,differences:[{field:'region',before:null,after:{type:'header',destinations:deviceScreens.map(item=>({screenId:item.id,label:item.name}))},message:'현재 화면 이름과 실제 이동 대상으로 만든 새 헤더를 추가하고 기준 화면에 연결합니다.'}]}));
      analysis.candidates.push({id:JSON.stringify([device,'header',source.id]),kind:'generated',region:'header',device,sourceScreenId:source.id,sourceElementId:preview.id,targetScreenIds:targets.map(target=>target.screenId),targets,sourceChanges,sourcePreview:preview,elementIdMaps:{},reasons:['이 기기의 대상 화면에 헤더·사이드바·푸터가 없어 새 공통 헤더를 제안합니다.','현재 화면의 이름과 ID만 사용하며 AI 요청은 발생하지 않습니다.','기준 화면과 선택한 대상 화면에 새 요소를 추가합니다. 기존 본문은 유지합니다.']});
    }
  }
  return analysis;
}

/** Apply only reviewed targets; all checks precede the first new screen object. */
export function applyNavigationInference(screens:WireScreen[],analysis:NavigationInferenceAnalysis,selections:NavigationInferenceSelection[],uid:()=>string=()=>crypto.randomUUID()):WireScreen[] {
  assertInput(screens);
  if(analysis.snapshotKey!==JSON.stringify(screens))throw new Error(staleMessage);
  const fresh=inferNavigationCandidates(screens,optionsValue(analysis.options)),candidates=new Map(fresh.candidates.map(candidate=>[candidate.id,candidate]));
  const chosen=new Set<string>(),targets=new Set<string>();
  const plans:{candidate:NavigationInferenceCandidate;target:NavigationInferenceTarget}[]=[];
  for(const selection of selections){
    const candidate=candidates.get(selection.candidateId);
    if(!candidate||chosen.has(selection.candidateId))throw new Error('분석 결과의 선택이 올바르지 않습니다. 다시 분석해 주세요.');
    chosen.add(selection.candidateId);
    if(!selection.targetScreenIds.length)throw new Error('연결할 대상 화면을 선택해 주세요.');
    for(const targetScreenId of selection.targetScreenIds){
      const key=JSON.stringify([candidate.region,targetScreenId]);
      if(!candidate.targetScreenIds.includes(targetScreenId)||targets.has(key))throw new Error('대상 화면이 중복되거나 분석 이후 바뀌었습니다. 다시 분석해 주세요.');
      const target=candidate.targets.find(target=>target.screenId===targetScreenId)!;
      if(target.kind!=='exact'&&selection.allowChanges!==true)throw new Error('문구·스타일 변경과 새 영역 추가를 확인한 대상만 적용할 수 있습니다.');
      targets.add(key);plans.push({candidate,target});
    }
  }
  if(!plans.length)return screens;
  const usedIds=new Set(screens.flatMap(screen=>flattenElements(screen.elements).map(element=>element.id)));
  const newId=()=>{
    for(let attempt=0;attempt<100;attempt++){const id=uid();if(typeof id==='string'&&id.length>0&&id.length<=120&&!usedIds.has(id)){usedIds.add(id);return id;}}
    throw new Error('중복되지 않는 새 요소 ID를 만들지 못했습니다. 기존 화면은 변경하지 않았습니다.');
  };
  let result=screens;
  const generatedSources=new Map<string,WireElement>();
  for(const {candidate,target} of plans){
    let source=result.find(screen=>screen.id===candidate.sourceScreenId)!;
    if(candidate.kind==='generated'&&!generatedSources.has(candidate.id)){
      const [created]=mapElements(structuredClone([candidate.sourcePreview!]),element=>({...element,id:newId()}));
      source={...source,elements:[created,...source.elements]};generatedSources.set(candidate.id,created);
      result=result.map(screen=>screen.id===source.id?source:screen);
    }
    const sourceElement=generatedSources.get(candidate.id)||screenNavigation(source).find(item=>item.type===candidate.region)!.element;
    let screen=result.find(screen=>screen.id===target.screenId)!,elementIdMap:Record<string,string>;
    if(target.kind==='missing'||target.kind==='generated'){
      const copied=applyNavigation(result,source.id,[screen.id],[candidate.region],newId);
      screen=copied.find(item=>item.id===screen.id)!;
      const targetElement=screenNavigation(screen).find(item=>item.type===candidate.region)!.element,targetElements=flattenElements([targetElement]);
      elementIdMap=Object.fromEntries(flattenElements([sourceElement]).map((element,index)=>[element.id,targetElements[index].id]));
    }else{
      elementIdMap={...candidate.elementIdMaps[screen.id]};
      if(target.kind==='similar'){
        const [canonical]=mapElements(structuredClone([sourceElement]),element=>({...element,id:elementIdMap[element.id],...(element.targetElementId?{targetElementId:elementIdMap[element.targetElementId]}:{})}));
        screen={...screen,elements:updateElement(screen.elements,elementIdMap[sourceElement.id],()=>canonical)};
      }
    }
    screen={...screen,navigationSync:{...screen.navigationSync,[candidate.region]:{sourceScreenId:source.id,sourceElementId:sourceElement.id,elementIdMap}}};
    result=result.map(item=>item.id===screen.id?screen:item);
  }
  assertInput(result);
  return result;
}
