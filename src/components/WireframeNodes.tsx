import { useEffect, useRef, type CSSProperties } from 'react';
import { ChevronRight, Image, X } from 'lucide-react';
import type { WireElement } from '../../shared/schema';
import { containerTypes, elementLabels } from '../wireframe-tree';

type Props = {elements:WireElement[];preview:boolean;selectedId:string|null;onSelect:(id:string)=>void;onAction:(element:WireElement)=>void;modalRoot?:boolean;interactionHints?:Set<string>};
function nodeStyle(item:WireElement):CSSProperties {
  const style=item.style || {};
  return {gap:style.gap,padding:style.padding,width:style.width,height:style.height,minHeight:item.type==='spacer'?(style.height || 24):undefined,background:style.background,color:style.color,fontSize:style.fontSize,alignItems:style.align==='start'?'flex-start':style.align==='end'?'flex-end':style.align,justifyContent:style.justify==='between'?'space-between':style.justify==='start'?'flex-start':style.justify==='end'?'flex-end':style.justify,gridTemplateColumns:item.type==='grid'?`repeat(${style.columns || 2},minmax(0,1fr))`:undefined,...(style.width!==undefined?{flex:`0 0 ${style.width}px`}:{})};
}
export function WireframeNodes({elements,preview,selectedId,onSelect,onAction,modalRoot=false,interactionHints}:Props) {
  return <>{elements.map(item=>{
    if (preview && item.type==='modal' && !modalRoot) return null;
    const children=item.children || [];
    let content;
    switch(item.type) {
      case 'heading':content=<h2>{item.text}</h2>;break;
      case 'text':content=<p>{item.text}</p>;break;
      case 'button':content=<button className="wf-live-button" style={{background:item.style?.background,color:item.style?.color,fontSize:item.style?.fontSize}} tabIndex={preview?0:-1} onClick={()=>preview&&onAction(item)}>{item.text}<ChevronRight size={15}/></button>;break;
      case 'input':content=<label className="wf-live-input">{item.text}<input aria-label={item.text} placeholder={item.text} readOnly={!preview} tabIndex={preview?0:-1}/></label>;break;
      case 'card':content=<>{item.text&&<div className="wf-card-copy">{item.text.split('\n').map((line,index)=>index===0?<strong key={index}>{line}</strong>:<p key={index}>{line}</p>)}</div>}<WireframeNodes {...{elements:children,preview,selectedId,onSelect,onAction,interactionHints}}/></>;break;
      case 'image':content=<div className="wf-live-image"><Image size={30}/><span>{item.text||'이미지 영역'}</span></div>;break;
      case 'nav':content=<button className="wf-live-nav" style={{color:item.style?.color,fontSize:item.style?.fontSize}} tabIndex={preview?0:-1} onClick={()=>preview&&onAction(item)}>{item.text}<ChevronRight size={14}/></button>;break;
      case 'divider':content=<hr/>;break;
      case 'spacer':content=preview?null:<span className="wf-spacer-label" data-export-ignore="true">여백</span>;break;
      case 'table':content=<div className="wf-table-scroll"><table><caption>{item.text}</caption><thead><tr>{(item.columns||[]).map((column,index)=><th key={index}>{column}</th>)}</tr></thead><tbody>{(item.rows||[]).map((row,rowIndex)=><tr key={rowIndex}>{row.map((cell,index)=><td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>;break;
      default:content=<>{item.type==='modal'&&!preview&&<div className="wf-modal-editor-label" data-export-ignore="true">모달</div>}{item.text&&<div className="wf-container-copy">{item.text}</div>}<WireframeNodes {...{elements:children,preview,selectedId,onSelect,onAction,interactionHints}}/>{!children.length&&!item.text&&!preview&&<span className="wf-container-empty">{elementLabels[item.type]} · 요소를 추가하세요</span>}</>;
    }
    return <div key={item.id} style={nodeStyle(item)} className={`wf-element wf-element-${item.type} ${containerTypes.has(item.type)?'wf-container':''} ${!preview&&item.id===selectedId?'is-selected':''} ${preview?'is-preview':''} ${preview&&interactionHints?.has(item.id)?'wf-interactive-hint':''}`}
      onClick={event=>{if(!preview){event.stopPropagation();onSelect(item.id);}}}
      onKeyDown={event=>{if(!preview&&event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopPropagation();onSelect(item.id);}}}
      tabIndex={preview?undefined:0} role={preview?undefined:'group'} aria-roledescription={preview?undefined:'편집 요소'} aria-keyshortcuts={preview?undefined:'Enter Space'} aria-description={preview?undefined:'Enter 또는 Space 키를 눌러 이 요소의 속성을 편집합니다.'} aria-label={preview?undefined:`${elementLabels[item.type]} 편집: ${item.text.slice(0,30)}`} data-testid={`wire-element-${item.id}`}>
      {!preview&&item.id===selectedId&&<span className="wf-element-tag" data-export-ignore="true">{elementLabels[item.type]}</span>}{content}
    </div>;
  })}</>;
}
export function WireframeOverlay({element,onClose,onAction}:{element:WireElement;onClose:()=>void;onAction:(element:WireElement)=>void}) {
  const dialog=useRef<HTMLDivElement>(null),close=useRef(onClose),previousFocus=useRef(document.activeElement as HTMLElement|null);close.current=onClose;
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close.current();}if(event.key==='Tab'){const focusable=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]');if(!focusable?.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(!dialog.current?.contains(document.activeElement)){event.preventDefault();first.focus();}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);if(previousFocus.current?.isConnected)previousFocus.current.focus();};},[]);
  return <div className="wf-modal-backdrop" onClick={onClose}><div ref={dialog} className="wf-modal-dialog" role="dialog" aria-modal="true" aria-label={element.text||'와이어프레임 모달'} onClick={event=>event.stopPropagation()} style={{width:element.style?.width||480,background:element.style?.background}}><button className="wf-modal-close" autoFocus onClick={onClose} aria-label="와이어프레임 모달 닫기"><X size={18}/></button>{element.text&&<h2 className="wf-modal-title">{element.text}</h2>}<WireframeNodes elements={element.children||[]} preview selectedId={null} onSelect={()=>{}} onAction={onAction}/></div></div>;
}
export function WireframeLayerTree({elements,selectedId,onSelect,depth=0}:{elements:WireElement[];selectedId:string|null;onSelect:(id:string)=>void;depth?:number}) {
  return <>{elements.map(item=><div key={item.id}><button className={`wf-layer ${item.id===selectedId?'is-selected':''}`} style={{paddingLeft:8+depth*12}} onClick={()=>onSelect(item.id)} aria-label={`레이어 선택: ${item.text||elementLabels[item.type]}`} data-testid={`layer-${item.id}`}><span>{item.text||elementLabels[item.type]}</span><small>{elementLabels[item.type]}</small></button>{item.children?.length?<WireframeLayerTree elements={item.children} selectedId={selectedId} onSelect={onSelect} depth={depth+1}/>:null}</div>)}</>;
}
