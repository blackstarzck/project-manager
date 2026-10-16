import { useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import type { WireScreen } from '../../shared/schema';
import { navigationRegionLabels, screenNavigation, type NavigationRegion } from '../wireframe-navigation';
import { Modal } from './ui';
import './wireframe-generation.css';

type Props={screens:WireScreen[];source:WireScreen;disabled?:boolean;onClose:()=>void;onApply:(targetIds:string[],regions:NavigationRegion[],sync:boolean)=>void};
export function WireframeNavigationDialog({screens,source,disabled,onClose,onApply}:Props){
  const initial=useRef(source.id);
  const available=screenNavigation(source);
  const choices=screens.filter(screen=>screen.id!==source.id);
  const [targets,setTargets]=useState<string[]>(()=>choices.filter(screen=>screen.device===source.device).map(screen=>screen.id));
  const [regions,setRegions]=useState<NavigationRegion[]>(()=>available.map(region=>region.type));
  const [sync,setSync]=useState(false);
  const ids=choices.filter(screen=>targets.includes(screen.id)).map(screen=>screen.id);
  const selected=available.filter(region=>regions.includes(region.type)).map(region=>region.type);
  const blocked=disabled||initial.current!==source.id||!ids.length||!selected.length;
  return <Modal title="공통 내비게이션 적용" onClose={onClose}><form onSubmit={event=>{event.preventDefault();if(!blocked)onApply(ids,selected,sync);}}>
    <p className="field-help">기준 화면: <strong>{source.name}</strong>. 선택한 영역을 다른 화면에 적용합니다. 본문과 선택하지 않은 영역은 유지됩니다.</p>
    <fieldset className="wf-navigation-regions"><legend>공통 영역</legend>{available.map(({type})=><label key={type}><input type="checkbox" aria-label={`${navigationRegionLabels[type]} 적용`} checked={regions.includes(type)} onChange={event=>setRegions(event.target.checked?[...regions,type]:regions.filter(item=>item!==type))}/>{navigationRegionLabels[type]}</label>)}</fieldset>
    <div className="wf-generation-selection"><label><input type="checkbox" aria-label="공통 영역 대상 전체 선택" checked={choices.length>0&&ids.length===choices.length} onChange={event=>setTargets(event.target.checked?choices.map(screen=>screen.id):[])}/>전체 선택</label><span>{ids.length}개 화면 선택</span></div>
    <div className="wf-generation-list" role="group" aria-label="공통 영역 대상 화면">{choices.map(screen=><label key={screen.id}><input type="checkbox" aria-label={`${screen.name} 공통 영역 적용`} checked={ids.includes(screen.id)} onChange={event=>setTargets(event.target.checked?[...targets,screen.id]:targets.filter(id=>id!==screen.id))}/><span>{screen.name}</span><small>{screen.device}</small></label>)}</div>
    <label className="wf-sync-option"><input type="checkbox" aria-label="이후 변경도 자동 동기화" checked={sync} onChange={event=>setSync(event.target.checked)}/><span><strong>이후 변경도 자동 동기화</strong><small>기준 화면을 편집하면 연결된 영역도 바뀝니다. 같은 기기의 화면에 연결하며, 연결 해제 후 개별 편집할 수 있습니다.</small></span></label>
    <p className="field-help">{sync?'동기화는 현재 화면 버전 안에서만 적용됩니다. 기준 화면이나 영역을 삭제하면 마지막 내용을 보존하고 연결을 해제합니다.':'복사 후에는 각 화면에서 따로 편집합니다. 화면별 실행 취소로 되돌릴 수 있습니다.'} 복사 범위 밖의 모달 연결은 해제됩니다.</p>
    <div className="modal-footer"><button className="secondary" type="button" onClick={onClose}>취소</button><button className="primary" type="submit" disabled={blocked}><Copy size={14}/>선택한 화면에 공통 영역 적용</button></div>
  </form></Modal>;
}
