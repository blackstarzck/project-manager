import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Download, Grip, Layers, LayoutTemplate, Maximize, Minus, Monitor, MousePointer2, PanelLeft, PanelRight, Plus, Redo2, Search, Smartphone, Sparkles, Tablet, Trash2, Undo2, X } from 'lucide-react';
import type { Project, WireElement, WireScreen, WireframeGenerationMode } from '../../shared/schema';
import { EmptyState, ErrorBanner, Modal, uid } from './ui';
import { WireframeNodes, WireframeOverlay, WireframeLayerTree } from './WireframeNodes';
import { WireframeLayoutInspector } from './WireframeLayoutInspector';
import { WireframeGenerationDialog } from './WireframeGenerationDialog';
import { capturePng } from '../capture-png';
import { wireDevices } from '../../shared/devices';
import { applyNavigation, detachNavigationHistory, linkNavigation, linkedNavigationRegion, navigationRegionLabels, navigationRegions, screenNavigation, synchronizeNavigation, unlinkNavigation } from '../wireframe-navigation';
import { WireframeNavigationDialog } from './WireframeNavigationDialog';
import { WireframeNavigationInferenceDialog } from './WireframeNavigationInferenceDialog';
import { applyNavigationInference } from '../../shared/wireframe-navigation-inference';
import { clearElementLinks, containerTypes, createElement, findElement, flattenElements, mapElements, moveElement, parentOf, removeElement, reorderElement as reorderTreeElement, screenTemplate, treeDepth, updateElement, elementLabels } from '../wireframe-tree';
import '../wireframe.css';
import { useEditorPanels } from '../editors/useEditorPanels';
import '../editor-layout.css';

type Props = { project: Project; onChange: (screens: WireScreen[]) => void; onGenerate: (prompt: string, entityIds?: string[], mode?: WireframeGenerationMode) => void; disabled?: boolean };
const fingerprint = (screens: WireScreen[]) => JSON.stringify(screens.map(({revision:_,...screen}) => screen));
function downloadUrl(url: string, name: string) { const link = document.createElement('a'); link.href=url; link.download=name; link.click(); }

export function WireframeEditor({ project, onChange, onGenerate, disabled = false }: Props) {
  const screens = project.wireframes;
  const [selectedId,setSelectedId] = useState<string|null>(screens[0]?.id || null);
  const [elementId,setElementId] = useState<string|null>(null);
  const [preview,setPreview] = useState(false);
  const panels = useEditorPanels({ leftWidth: 240, rightWidth: 280, rightAvailable: screens.length > 0 && !preview });
  const selectElement = (id: string | null) => { setElementId(id); if (id) panels.open('right'); };
  const [screenQuery,setScreenQuery] = useState('');
  const [showInteractionHints,setShowInteractionHints] = useState(false);
  const [pageHistory,setPageHistory] = useState<string[]>([]);
  const [openModalId,setOpenModalId] = useState<string|null>(null);
  const [zoom,setZoom] = useState('fit');
  const [availableWidth,setAvailableWidth] = useState(850);
  const [canvasHeight,setCanvasHeight] = useState(900);
  const [showCreate,setShowCreate] = useState(false);
  const [showNavigation,setShowNavigation] = useState(false);
  const [showInference,setShowInference] = useState(false);
  const [generationVersion,setGenerationVersion] = useState<string|null>(null);
  const [name,setName] = useState('');
  const [flowNodeId,setFlowNodeId] = useState('');
  const [device,setDevice] = useState<WireScreen['device']>('desktop');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [exporting,setExporting] = useState(false);
  const [past,setPast] = useState<Record<string,WireScreen[]>>({});
  const [future,setFuture] = useState<Record<string,WireScreen[]>>({});
  const expected = useRef(fingerprint(screens));
  const surface = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const previewViewport = useRef<HTMLDivElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const context = useRef(project.selectedFlowVersionId);
  const selected = screens.find(screen=>screen.id===selectedId) || screens[0];
  const element = findElement(selected?.elements||[],elementId);
  const linkedRegion = selected&&element ? flattenElements([element]).map(item=>linkedNavigationRegion(selected,item.id)).find(Boolean) : undefined;
  const parent = element&&selected?parentOf(selected.elements,element.id):null;
  const siblings = parent?.children||selected?.elements||[];
  const dimensions = wireDevices[selected?.device || 'desktop'];
  const scale = zoom==='fit'?Math.min(1,Math.max(.12,(availableWidth-48)/dimensions.width)):Number(zoom)/100;
  const modal = findElement(selected?.elements||[],openModalId);
  const pages = project.flow.nodes.filter(node=>node.type==='page');
  const missingPages = pages.filter(node=>!screens.some(screen=>screen.flowNodeId===node.id));
  const pageIndex = screens.findIndex(screen=>screen.id===selected?.id);
  const screenSection = (screen:WireScreen) => project.flow.sections.find(section=>section.id===pages.find(node=>node.id===screen.flowNodeId)?.sectionId);
  const visibleScreens = screens.filter(screen=>`${screen.name} ${screenSection(screen)?.title||'미지정 화면'}`.toLocaleLowerCase().includes(screenQuery.trim().toLocaleLowerCase()));
  const screenGroups = [...project.flow.sections.map(section=>({id:section.id,title:section.title,screens:visibleScreens.filter(screen=>screenSection(screen)?.id===section.id)})),{id:'unassigned',title:'미지정 화면',screens:visibleScreens.filter(screen=>!screenSection(screen))}].filter(group=>group.screens.length);
  const interactiveIds = new Set(flattenElements(selected?.elements||[]).filter(item=>{
    if(item.type==='input')return true;
    if(item.type!=='button'&&item.type!=='nav')return false;
    if(item.action==='back')return pageHistory.length>0;
    if(item.action==='closeModal')return !!openModalId;
    if(item.action==='openModal')return findElement(selected?.elements||[],item.targetElementId||null)?.type==='modal';
    return screens.some(screen=>screen.id===item.targetScreenId);
  }).map(item=>item.id));
  const flowGroup=project.flowGroups.find(group=>group.versions.some(version=>version.id===project.selectedFlowVersionId));
  const flowVersion=flowGroup?.versions.find(version=>version.id===project.selectedFlowVersionId);
  const screenVersion=flowVersion?.wireframeVersions.find(version=>version.id===project.selectedWireframeVersionId);
  const currentFingerprint=fingerprint(screens);
  useEffect(()=>{if(expected.current!==currentFingerprint){setPast({});setFuture({});expected.current=currentFingerprint;}},[currentFingerprint]);
  useEffect(()=>{if(context.current!==project.selectedFlowVersionId){context.current=project.selectedFlowVersionId;setSelectedId(null);setElementId(null);setOpenModalId(null);setGenerationVersion(null);setPageHistory([]);setPast({});setFuture({});}},[project.selectedFlowVersionId]);
  useEffect(()=>{const node=stage.current;if(!node)return;const measure=()=>setAvailableWidth(node.clientWidth);const observer=new ResizeObserver(measure);observer.observe(node);measure();return()=>observer.disconnect();},[]);
  useEffect(()=>{const node=surface.current;if(!node)return;const measure=()=>setCanvasHeight(node.offsetHeight);const observer=new ResizeObserver(measure);observer.observe(node);measure();return()=>observer.disconnect();},[selected?.id,selected?.device,preview]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),3500);return()=>clearTimeout(timer);},[notice]);
  useEffect(()=>{setShowInteractionHints(false);previewViewport.current?.scrollTo(0,0);return()=>{if(hintTimer.current)clearTimeout(hintTimer.current);};},[selected?.id,preview]);

  const change = (next: WireScreen[], history = true) => {
    if(disabled)return false;
    const incoming=next;
    try{next=synchronizeNavigation(screens,next,uid);}catch(caught){setError((caught as Error).message);return false;}
    if(next.some(screen=>flattenElements(screen.elements).some(element=>element.text.length>4000))){setError('요소 내용은 4,000자까지 입력할 수 있어요. 기존 화면은 변경하지 않았습니다.');return false;}
    if(next.some(screen=>screen.elements.length>100||flattenElements(screen.elements).some(element=>(element.children?.length||0)>100))){setError('한 컨테이너 안에는 요소를 100개까지 추가할 수 있어요. 기존 화면은 변경하지 않았습니다.');return false;}
    if(next.some(screen=>flattenElements(screen.elements).length>500||treeDepth(screen.elements)>8)){setError('화면은 요소 500개, 중첩 8단계까지 구성할 수 있어요.');return false;}
    if(history){
      const changed=screens.filter(screen=>{const updated=next.find(item=>item.id===screen.id);return updated&&fingerprint([updated])!==fingerprint([screen]);});
      setPast(items=>{const copy={...items};for(const screen of changed)copy[screen.id]=[...(copy[screen.id]||[]).slice(-29),structuredClone(screen)];return copy;});
      setFuture(items=>{const copy={...items};for(const screen of changed)delete copy[screen.id];return copy;});
    }
    const detached=next.flatMap(screen=>{const prior=incoming.find(item=>item.id===screen.id);const bindings=Object.fromEntries(navigationRegions.filter(region=>prior?.navigationSync?.[region]&&!screen.navigationSync?.[region]).map(region=>[region,prior!.navigationSync![region]]));return Object.keys(bindings).length?[{screen,bindings}]:[];});
    if(detached.length){
      const clean=(items:Record<string,WireScreen[]>)=>{const copy={...items};for(const {screen,bindings} of detached)if(copy[screen.id])copy[screen.id]=copy[screen.id].map(snapshot=>detachNavigationHistory(snapshot,screen,bindings,uid));return copy;};
      setPast(clean);setFuture(clean);setNotice('기준 영역 또는 기기가 변경되어 연결을 해제했습니다. 각 화면의 마지막 내용은 유지됩니다.');
    }
    expected.current=fingerprint(next);onChange(next);return true;
  };
  const patchScreen = (patch: Partial<WireScreen>) => { if(selected)change(screens.map(screen=>screen.id===selected.id?{...screen,...patch}:screen)); };
  const patchElement = (patch: Partial<WireElement>) => { if(selected&&element){let elements=updateElement(selected.elements,element.id,item=>({...item,...patch}));if(element.type==='modal'&&patch.type&&patch.type!=='modal')elements=clearElementLinks(elements,new Set([element.id]));patchScreen({elements});} };
  const select = (id: string) => {setSelectedId(id);setElementId(null);setNotice('');setOpenModalId(null);};
  const togglePreview=()=>{setPreview(!preview);setPageHistory([]);setElementId(null);setOpenModalId(null);};
  const movePreviewPage=(direction:number)=>{const next=screens[pageIndex+direction];if(next){select(next.id);setPageHistory([]);}};
  const changeZoom=(direction:number)=>setZoom(String(Math.min(200,Math.max(25,Math.round(scale*100/25)*25+direction*25))));
  const flashInteractionHints=()=>{if(hintTimer.current)clearTimeout(hintTimer.current);setShowInteractionHints(true);hintTimer.current=setTimeout(()=>setShowInteractionHints(false),1600);};
  const undo=()=>{if(!selected)return;const stack=past[selected.id]||[];const previous=stack.at(-1);if(!previous||!change(screens.map(screen=>screen.id===selected.id?previous:screen),false))return;setPast({...past,[selected.id]:stack.slice(0,-1)});setFuture({...future,[selected.id]:[...(future[selected.id]||[]),structuredClone(selected)]});};
  const redo=()=>{if(!selected)return;const stack=future[selected.id]||[];const next=stack.at(-1);if(!next||!change(screens.map(screen=>screen.id===selected.id?next:screen),false))return;setFuture({...future,[selected.id]:stack.slice(0,-1)});setPast({...past,[selected.id]:[...(past[selected.id]||[]),structuredClone(selected)]});};
  const addElement = (type: WireElement['type']) => {
    if(!selected||linkedRegion)return;
    const next=createElement(type,uid),target=element&&containerTypes.has(element.type)?element:parent;
    if((target?.children||selected.elements).length>=100){setError('한 컨테이너 안에는 요소를 100개까지 추가할 수 있어요.');return;}
    patchScreen({elements:target?updateElement(selected.elements,target.id,item=>({...item,children:[...(item.children||[]),next]})):[...selected.elements,next]});setElementId(next.id);
  };
  const reorderElement=(direction:number)=>{if(selected&&element)patchScreen({elements:reorderTreeElement(selected.elements,element.id,direction)});};
  const reorderScreen=(direction:number)=>{if(!selected)return;const items=[...screens],index=items.findIndex(item=>item.id===selected.id),target=index+direction;if(target<0||target>=items.length)return;[items[index],items[target]]=[items[target],items[index]];change(items);};
  const createScreen=()=>{
    if(!name.trim())return;
    const screen:WireScreen={id:uid(),revision:0,name:name.trim(),device,flowNodeId:flowNodeId||null,flowRevision:project.artifactRevisions.flow,elements:screenTemplate(name.trim(),device,uid)};
    if(change([...screens,screen])){select(screen.id);setShowCreate(false);setName('');}
  };
  const removeScreen=()=>{if(!selected)return;change(screens.filter(screen=>screen.id!==selected.id).map(screen=>({...screen,elements:mapElements(screen.elements,item=>item.targetScreenId===selected.id?{...item,targetScreenId:null,action:undefined}:item)})),false);setPast({});setFuture({});setSelectedId(null);setElementId(null);setOpenModalId(null);setPageHistory([]);};
  const navigate=(item:WireElement)=>{if(item.action==='closeModal'){setOpenModalId(null);return;}if(item.action==='back'){const previous=pageHistory.at(-1);if(previous){select(previous);setPageHistory(pageHistory.slice(0,-1));}else setNotice('이전 화면이 없습니다.');return;}if(item.action==='openModal'){const target=findElement(selected?.elements||[],item.targetElementId||null);if(target?.type==='modal')setOpenModalId(target.id);else setNotice('연결된 모달이 없습니다.');return;}if(!item.targetScreenId){if(item.type==='button'||item.type==='nav')setNotice('이 요소에는 이동할 화면이 연결되어 있지 않습니다. 편집 모드에서 연결할 수 있어요.');return;}if(selected)setPageHistory([...pageHistory,selected.id]);select(item.targetScreenId);};
  const capture=async()=>{if(!surface.current||!selected)return;setExporting(true);setError('');try{const image=await capturePng(surface.current);downloadUrl(image,`${selected.name}.png`);}catch{setError('이미지를 만들지 못했습니다. 화면을 다시 연 뒤 시도해 주세요.');}finally{setExporting(false);}};

  return <div ref={panels.ref} data-reserved-width={panels.reservedWidth} data-preferred-reserved-width={panels.preferredReservedWidth} data-min-canvas-width="600" className={`wf-editor ux-editor ${preview?'wf-preview-mode':''}`} data-testid="wireframe-editor">
    <div className="wf-toolbar">
      <div className="wf-toolbar-title"><LayoutTemplate size={17}/><strong>와이어프레임</strong><span className="badge">{screens.length}개 화면</span></div>
      <div className="wf-toolbar-actions">
        <button id="wf-list-toggle" className="secondary small editor-panel-toggle" aria-label="화면 목록 표시" aria-expanded={panels.leftVisible} aria-controls="wf-list-panel" onClick={()=>panels.toggle('left')}><PanelLeft size={15}/>화면 목록</button>
        {selected&&!preview&&<button id="wf-properties-toggle" className="secondary small editor-panel-toggle" aria-label="화면 속성 표시" aria-expanded={panels.rightVisible} aria-controls="wf-properties-panel" onClick={()=>panels.toggle('right')}><PanelRight size={15}/>속성</button>}
        <button className="icon-button" aria-label="화면 편집 실행 취소" onClick={undo} disabled={disabled||!selected||!(past[selected.id]?.length)||preview}><Undo2 size={16}/></button>
        <button className="icon-button" aria-label="화면 편집 다시 실행" onClick={redo} disabled={disabled||!selected||!(future[selected.id]?.length)||preview}><Redo2 size={16}/></button>
        {!preview&&<select className="wf-zoom" aria-label="화면 배율" value={zoom} onChange={event=>setZoom(event.target.value)}><option value="fit">화면에 맞춤</option>{[25,50,75,100,125,150,175,200].map(value=><option key={value} value={String(value)}>{value}%</option>)}</select>}
        <button className="secondary small" onClick={capture} disabled={!selected||exporting}><Download size={14}/>{exporting?'내보내는 중':'PNG'}</button>
        <button className={`secondary small ${preview?'wf-active':''}`} onClick={togglePreview} disabled={!selected}><MousePointer2 size={14}/>{preview?'편집으로 돌아가기':'미리보기'}</button>
      </div>
    </div>
    {error&&<ErrorBanner message={error} onClose={()=>setError('')}/>}
    <div className="wf-body">
      <aside id="wf-list-panel" className={`wf-pages ${panels.panelClass('left')}`} aria-label="화면 목록" hidden={!panels.leftVisible} data-editor-panel="wireframe-pages" data-reserved-width={panels.leftDocked?240:0} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&event.currentTarget.contains(event.target as globalThis.Node)&&!panels.leftDocked){panels.close('left');document.getElementById('wf-list-toggle')?.focus();}}}>
        <div className="wf-panel-label"><span>화면 <b>{screens.length}</b></span><button className="icon-button" aria-label="화면 목록 접기" onClick={()=>{panels.close('left');document.getElementById('wf-list-toggle')?.focus();}}><X size={15}/></button><button className="icon-button" aria-label="화면 추가" onClick={()=>{setName(missingPages[0]?.label||'새 화면');setFlowNodeId(missingPages[0]?.id||'');setShowCreate(true);}} disabled={disabled}><Plus size={15}/></button></div>
        {preview&&<label className="wf-page-search"><Search size={14}/><input aria-label="화면 목록 검색" placeholder="화면 또는 섹션 검색" value={screenQuery} onChange={event=>setScreenQuery(event.target.value)}/>{screenQuery&&<button className="icon-button" aria-label="화면 검색 지우기" onClick={()=>setScreenQuery('')}><X size={12}/></button>}</label>}
        <div className="wf-page-list">{(preview?screenGroups:[{id:'all',title:'',screens}]).map(group=><section className="wf-page-group" key={group.id}>{preview&&<h4>{group.title}<span>{group.screens.length}</span></h4>}{group.screens.map(screen=><button className={`wf-page-item ${selected?.id===screen.id?'is-active':''}`} onClick={()=>{select(screen.id);if(preview)setPageHistory([]);}} key={screen.id} data-testid={`screen-${screen.id}`} aria-current={selected?.id===screen.id?'page':undefined}>
          <div className={`wf-miniature ${screen.device==='mobile'?'wf-mini-mobile':''}`}><span/><span/><span/><i/></div>
          <div className="wf-page-caption"><span>{String(screens.indexOf(screen)+1).padStart(2,'0')}</span><strong>{screen.name}</strong>{screen.flowRevision<project.artifactRevisions.flow&&<span className="wf-stale-dot" title="플로우 변경됨"/>}</div>
        </button>)}</section>)}</div>
        {preview&&!visibleScreens.length&&screens.length>0&&<p className="wf-side-hint">검색 결과가 없습니다.<br/>현재 화면은 그대로 유지됩니다.</p>}
        {!screens.length&&<p className="wf-side-hint">유저플로우의 페이지를<br/>화면으로 구체화하세요.</p>}
        <button className="wf-add-page" onClick={()=>{setName(missingPages[0]?.label||'새 화면');setFlowNodeId(missingPages[0]?.id||'');setShowCreate(true);}} disabled={disabled}><Plus size={15}/>화면 추가</button>
        {pages.length>0&&<button className="wf-generate" disabled={disabled} onClick={()=>setGenerationVersion(project.selectedFlowVersionId)}><Sparkles size={14}/>{missingPages.length?'미생성 화면 만들기':'전체 화면 개선'}</button>}
        {!preview&&<button className="wf-generate wf-infer-navigation" disabled={disabled||screens.length<2} onClick={()=>setShowInference(true)}><Layers size={14}/>공통 내비게이션 찾기</button>}
        {selected&&!preview&&<div className="wf-layers" role="group" aria-label="레이어 목록"><div className="wf-panel-label"><span>레이어</span><button className="text-button" onClick={()=>setElementId(null)}>화면 선택</button></div><WireframeLayerTree elements={selected.elements} selectedId={elementId} onSelect={selectElement}/></div>}
      </aside>
      <div className="wf-stage" ref={stage}>
        {!selected?<EmptyState icon={<LayoutTemplate size={27}/>} title="플로우를 실제 화면으로" action={<div className="wf-empty-actions"><button className="primary" disabled={disabled||!pages.length} onClick={()=>setGenerationVersion(project.selectedFlowVersionId)}><Sparkles size={15}/>AI로 화면 생성</button><button className="secondary" onClick={()=>{setName('새 화면');setShowCreate(true);}}>직접 만들기</button></div>}>{pages.length?'페이지의 목적과 기능을 바탕으로 첫 화면을 만들어 보세요.':'유저플로우에 페이지 노드를 추가하면 AI가 화면을 만들 수 있어요. 직접 화면을 구성할 수도 있습니다.'}</EmptyState>:<>
          <div className="wf-stage-head"><div><span className="eyebrow">{preview?'INTERACTIVE PREVIEW':'SCREEN EDITOR'}</span><h2>{selected.name}</h2></div><span className="wf-size-label">{selected.device==='desktop'?<Monitor size={13}/>:selected.device==='tablet'?<Tablet size={13}/>:<Smartphone size={13}/>} {wireDevices[selected.device].label} · {dimensions.width} × {dimensions.height}</span></div>
          {selected.flowRevision<project.artifactRevisions.flow&&<div className="wf-stale-banner">플로우가 변경되었습니다. 기존 화면은 보존되어 있습니다.<button onClick={()=>onGenerate('선택한 화면을 최신 플로우에 맞게 수정해 주세요. 사용자가 작성한 내용과 나머지 화면은 보존해 주세요.',[selected.id])} disabled={disabled}>변경 제안 받기</button></div>}
          {preview&&<div className="wf-preview-bar"><button disabled={!pageHistory.length} onClick={()=>{select(pageHistory.at(-1)!);setPageHistory(pageHistory.slice(0,-1));}}><ArrowLeft size={14}/>뒤로</button><span>버튼을 눌러 화면 사이를 이동해 보세요</span></div>}
          <div className={preview?'wf-preview-viewport':'wf-edit-viewport'} ref={previewViewport} data-testid="wireframe-viewport" onClick={event=>{if(preview&&!(event.target as HTMLElement).closest('button,input,select,textarea,a,[role="dialog"]'))flashInteractionHints();}}>
          <div className="wf-scaled-frame" style={{width:dimensions.width*scale,height:Math.max(dimensions.height,canvasHeight)*scale}}><div className={`wf-artboard ${selected.device==='mobile'?'is-mobile':''}`} ref={surface} style={{width:dimensions.width,minHeight:dimensions.height,transform:`scale(${scale})`}} data-testid="wireframe-preview" data-export="wireframes">
            <div className="wf-browser-chrome"><div><i/><i/><i/></div><span>{selected.name}</span><span><Layers size={11}/></span></div>
            <div className={`wf-screen-content ${selected.elements.some(item=>['header','row','body'].includes(item.type))?'wf-structured':''}`} style={{minHeight:dimensions.height-35}}><WireframeNodes elements={selected.elements} preview={preview} selectedId={elementId} onSelect={selectElement} onAction={navigate} interactionHints={showInteractionHints?interactiveIds:undefined}/>{selected.elements.length===0&&<div className="wf-empty-elements">오른쪽에서 요소를 추가해 보세요.</div>}</div>
            {preview&&modal?.type==='modal'&&<WireframeOverlay element={modal} onClose={()=>setOpenModalId(null)} onAction={navigate}/>}
          </div></div></div>
          {notice&&<div className="wf-notice" role="status">{notice}</div>}
          {preview?<div className="wf-preview-controls" aria-label="미리보기 도구">
            <div className="wf-preview-pagination"><button className="icon-button" aria-label="이전 화면" disabled={pageIndex<=0} onClick={()=>movePreviewPage(-1)}><ArrowLeft size={16}/></button><span role="status" aria-label="현재 화면 번호">{pageIndex+1} / {screens.length}</span><button className="icon-button" aria-label="다음 화면" disabled={pageIndex>=screens.length-1} onClick={()=>movePreviewPage(1)}><ArrowRight size={16}/></button></div>
            <button className="secondary small" disabled={disabled} onClick={()=>onGenerate('선택한 화면을 개선해 주세요. 사용자가 작성한 내용과 나머지 화면은 보존해 주세요.',[selected.id])}><Sparkles size={14}/>페이지 다시 생성</button><button className="secondary small" onClick={togglePreview}><MousePointer2 size={14}/>직접 편집</button>
            <div className="wf-preview-zoom"><button className="icon-button" aria-label="화면 축소" disabled={scale<=.25} onClick={()=>changeZoom(-1)}><Minus size={15}/></button><span aria-label="현재 화면 배율">{Math.round(scale*100)}%</span><button className="icon-button" aria-label="화면 확대" disabled={scale>=2} onClick={()=>changeZoom(1)}><Plus size={15}/></button><button className="icon-button" aria-label="화면에 맞추기" title="화면에 맞추기" onClick={()=>setZoom('fit')}><Maximize size={15}/></button></div>
          </div>:<div className="wf-stage-footer"><Check size={12}/>요소를 선택하면 내용과 화면 연결을 편집할 수 있어요</div>}
        </>}
      </div>
      {selected&&!preview&&<aside id="wf-properties-panel" className={`wf-inspector ${panels.panelClass('right')}`} aria-label="화면 속성" hidden={!panels.rightVisible} data-editor-panel="wireframe-properties" data-reserved-width={panels.rightDocked?280:0} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&event.currentTarget.contains(event.target as globalThis.Node)&&!panels.rightDocked){panels.close('right');document.getElementById('wf-properties-toggle')?.focus();}}}>
        <div className="wf-panel-label"><span>{element?'요소 속성':'화면 속성'}</span><button className="icon-button" aria-label="화면 속성 접기" onClick={()=>{panels.close('right');document.getElementById('wf-properties-toggle')?.focus();}}><X size={15}/></button>{element&&<button className="text-button" onClick={()=>setElementId(null)} aria-label="요소 선택 해제">화면 속성</button>}</div>
        {selected.navigationSync&&<div className="wf-sync-bindings" aria-label="공통 내비게이션 연결">{navigationRegions.filter(region=>selected.navigationSync?.[region]).map(region=>{const binding=selected.navigationSync![region]!;const source=screens.find(screen=>screen.id===binding.sourceScreenId);return <div className="wf-sync-binding" key={region}><strong>{navigationRegionLabels[region]} 자동 동기화</strong><span>기준: {source?.name||'기준 화면'}</span><div><button className="text-button" onClick={()=>select(binding.sourceScreenId)} disabled={disabled}>기준 화면으로 이동</button><button className="text-button" aria-label={`${navigationRegionLabels[region]} 동기화 연결 해제`} onClick={()=>change(unlinkNavigation(screens,selected.id,[region]))} disabled={disabled}>연결 해제</button></div></div>;})}</div>}
        {linkedRegion&&<p className="wf-sync-readonly" role="status">{navigationRegionLabels[linkedRegion]}는 기준 화면과 연결되어 있습니다. 기준 화면을 편집하거나 연결을 해제해 주세요.</p>}
        {element?<fieldset className="wf-properties wf-properties-fieldset" disabled={disabled||!!linkedRegion}>
          <label>요소 종류<select aria-label="요소 종류" value={element.type} onChange={event=>patchElement({type:event.target.value as WireElement['type']})} disabled={disabled}>{Object.entries(elementLabels).map(([value,label])=><option value={value} key={value} disabled={!!element.children?.length&&!containerTypes.has(value as WireElement['type'])}>{label}</option>)}</select></label>
          {element.type!=='divider'&&<label>내용<textarea aria-label="요소 내용" rows={5} maxLength={4000} value={element.text} onChange={event=>patchElement({text:event.target.value})} disabled={disabled}/><small className="wf-content-count">{element.text.length.toLocaleString()} / 4,000자</small></label>}
          {(element.type==='button'||element.type==='nav')&&(!element.action||element.action==='navigate')&&<label>클릭 시 이동<select aria-label="이동 대상 화면" value={element.targetScreenId||''} onChange={event=>patchElement({targetScreenId:event.target.value||null,action:event.target.value?element.action:undefined})} disabled={disabled}><option value="">연결 없음</option>{screens.map(screen=><option key={screen.id} value={screen.id}>{screen.name}</option>)}</select></label>}
          <WireframeLayoutInspector key={`${project.selectedFlowVersionId}:${selected.id}:${element.id}`} element={element} elements={selected.elements} disabled={disabled||!!linkedRegion} onPatch={patchElement} onMove={parentId=>{if(linkedNavigationRegion(selected,parentId)){setError('연결된 공통 영역에는 요소를 옮길 수 없습니다. 기준 화면을 편집하거나 연결을 해제해 주세요.');return;}patchScreen({elements:moveElement(selected.elements,element.id,parentId)});}}/>
          <div className="wf-order"><button className="secondary small" onClick={()=>reorderElement(-1)} disabled={disabled||siblings[0]?.id===element.id}><ArrowUp size={13}/>위로</button><button className="secondary small" onClick={()=>reorderElement(1)} disabled={disabled||siblings.at(-1)?.id===element.id}><ArrowDown size={13}/>아래로</button></div>
          <button className="ghost small wf-delete" onClick={()=>{const removed=new Set(flattenElements([element]).map(item=>item.id));patchScreen({elements:clearElementLinks(removeElement(selected.elements,element.id),removed)});setElementId(null);}} disabled={disabled}><Trash2 size={13}/>{element.children?.length?'요소와 하위 요소 삭제':'요소 삭제'}</button>
        </fieldset>:<div className="wf-properties">
          <label>화면 이름<input aria-label="화면 이름" value={selected.name} maxLength={200} onChange={event=>patchScreen({name:event.target.value})} onBlur={event=>{if(!event.target.value.trim())patchScreen({name:'제목 없는 화면'});}} disabled={disabled}/></label>
          <label>기기<div className="wf-device-controls"><button className={selected.device==='desktop'?'selected':''} onClick={()=>patchScreen({device:'desktop'})} disabled={disabled}><Monitor size={15}/>Desktop</button><button className={selected.device==='tablet'?'selected':''} onClick={()=>patchScreen({device:'tablet'})} disabled={disabled}><Tablet size={15}/>Tablet</button><button className={selected.device==='mobile'?'selected':''} onClick={()=>patchScreen({device:'mobile'})} disabled={disabled}><Smartphone size={15}/>Mobile</button></div></label>
          <label>연결된 플로우 페이지<select aria-label="연결된 플로우 페이지" value={selected.flowNodeId||''} onChange={event=>patchScreen({flowNodeId:event.target.value||null,flowRevision:project.artifactRevisions.flow})} disabled={disabled}><option value="">독립 화면</option>{pages.map(node=><option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
          <div className="wf-order"><button className="secondary small" onClick={()=>reorderScreen(-1)} disabled={disabled||screens[0]?.id===selected.id}><ArrowUp size={13}/>위로</button><button className="secondary small" onClick={()=>reorderScreen(1)} disabled={disabled||screens.at(-1)?.id===selected.id}><ArrowDown size={13}/>아래로</button></div>
          <button className="secondary wf-regenerate" onClick={()=>onGenerate('선택한 와이어프레임 화면을 개선해 주세요. 연결된 기능과 플로우를 반영하고 기존의 사용자 작성 텍스트를 최대한 보존해 주세요.',[selected.id])} disabled={disabled||!selected.flowNodeId}><Sparkles size={14}/>이 화면 AI 개선</button>
          <label className="wf-inference-exclude"><span><input type="checkbox" aria-label="공통 내비게이션 자동 찾기에서 제외" checked={!!selected.navigationInferenceExcluded} disabled={disabled} onChange={event=>patchScreen({navigationInferenceExcluded:event.target.checked})}/>공통 영역 자동 찾기에서 제외</span><small>이 화면은 새 연결 후보에서 제외합니다. 이미 연결한 영역은 연결 해제로 분리할 수 있어요.</small></label>
          {screens.length>1&&screenNavigation(selected).length>0&&<button className="secondary" disabled={disabled} onClick={()=>setShowNavigation(true)}><Layers size={14}/>공통 내비게이션 적용</button>}<button className="ghost small wf-delete" onClick={removeScreen} disabled={disabled}><Trash2 size={13}/>화면 삭제</button>
        </div>}
        <div className="wf-panel-label wf-section-divider"><span>요소 추가</span><Grip size={13}/></div>
        <div className="wf-element-palette">{Object.entries(elementLabels).map(([type,label])=><button key={type} onClick={()=>addElement(type as WireElement['type'])} disabled={disabled||!!linkedRegion}><Plus size={12}/>{label}</button>)}</div>
        <p className="wf-inspector-note">변경 내용은 자동 저장됩니다.<br/>이전 내용은 버전 기록에서 복원할 수 있어요.</p>
      </aside>}
    </div>
    {generationVersion&&generationVersion===project.selectedFlowVersionId&&<WireframeGenerationDialog key={generationVersion} project={project} disabled={disabled} onClose={()=>setGenerationVersion(null)} onGenerate={(prompt,ids,mode)=>{if(disabled||generationVersion!==project.selectedFlowVersionId||!ids.length)return;setGenerationVersion(null);onGenerate(prompt,ids,mode);}}/>}
    {showNavigation&&selected&&<WireframeNavigationDialog screens={screens} source={selected} disabled={disabled} onClose={()=>setShowNavigation(false)} onApply={(ids,regions,sync)=>{try{change(sync?linkNavigation(screens,selected.id,ids,regions,uid):applyNavigation(screens,selected.id,ids,regions,uid));}catch(caught){setError((caught as Error).message);}setShowNavigation(false);}}/>}
    {showInference&&<WireframeNavigationInferenceDialog screens={screens} contextId={`${project.id}:${project.selectedFlowVersionId}:${project.selectedWireframeVersionId}`} contextLabel={`${flowGroup?.name||'현재 플로우'} / ${flowVersion?.name||'현재 버전'} / ${screenVersion?.name||'현재 화면 버전'}`} disabled={disabled} onClose={()=>setShowInference(false)} onApply={(analysis,selections)=>{
      const next=applyNavigationInference(screens,analysis,selections);
      if(!change(next))return false;
      setNotice('찾은 공통 영역을 연결했습니다. 각 화면의 본문과 기존 요소 연결은 유지됩니다.');
      return true;
    }}/>} 
    {showCreate&&<Modal title="새 화면 만들기" onClose={()=>setShowCreate(false)}><form className="wf-create-form" onSubmit={event=>{event.preventDefault();createScreen();}}>{error&&<p role="alert" className="wf-create-error">{error}</p>}<label>화면 이름<input autoFocus aria-label="새 화면 이름" placeholder="예: 도서 상세" value={name} maxLength={200} onChange={event=>setName(event.target.value)} required/></label><label>플로우 페이지<select value={flowNodeId} onChange={event=>{setFlowNodeId(event.target.value);const node=pages.find(item=>item.id===event.target.value);if(node)setName(node.label);}}><option value="">독립 화면</option>{pages.map(node=><option key={node.id} value={node.id}>{node.label}</option>)}</select></label><label>기기<select value={device} onChange={event=>setDevice(event.target.value as WireScreen['device'])}><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select></label><div className="modal-actions"><button className="secondary" type="button" onClick={()=>setShowCreate(false)}>취소</button><button className="primary" type="submit" disabled={!name.trim()||disabled}>화면 만들기</button></div></form></Modal>}
  </div>;
}





