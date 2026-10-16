import { useMemo, useState } from 'react';
import { ArrowRight, Layers, Link2, RefreshCw, Search } from 'lucide-react';
import type { WireElement, WireScreen } from '../../shared/schema';
import { wireDevices } from '../../shared/devices';
import { navigationRegionLabels } from '../../shared/wireframe-navigation';
import { inferNavigationCandidates, type NavigationInferenceAnalysis, type NavigationInferenceSelection, type NavigationInferenceDifference } from '../../shared/wireframe-navigation-inference';
import { Modal } from './ui';
import './wireframe-navigation-inference.css';

type Props = {
  screens: WireScreen[];
  contextId: string;
  contextLabel: string;
  disabled?: boolean;
  onClose: () => void;
  onApply: (analysis: NavigationInferenceAnalysis, selections: NavigationInferenceSelection[]) => boolean;
};

type Snapshot = { analysis: NavigationInferenceAnalysis | null; screens: WireScreen[]; contextId: string; contextLabel: string; inputKey: string; error: string };
const initialSelection = (analysis: NavigationInferenceAnalysis | null, all = false): Record<string,string[]> => Object.fromEntries((analysis?.candidates || []).map(candidate => [candidate.id,candidate.targets.filter(target => all || target.kind === 'exact').map(target => target.screenId)]));
const kindLabels = { exact:'기존 내용 유지', similar:'메뉴 표현 통합', missing:'없는 영역 추가', generated:'새 메뉴 생성' };
const diffValue = (value: unknown) => value === undefined ? '없음' : typeof value === 'string' ? value || '(빈 내용)' : JSON.stringify(value);
function Differences({ items }: { items: NavigationInferenceDifference[] }) {
  return <ul className="wf-inference-differences">{items.map((item,index) => <li key={`${item.elementId || item.field}:${index}`}><span>{item.message}</span>{item.field !== 'region' && <div><del>{diffValue(item.before)}</del><ArrowRight size={12}/><ins>{diffValue(item.after)}</ins></div>}</li>)}</ul>;
}
function MenuPreview({ element }: { element: WireElement }) {
  return <div className="wf-inference-menu-preview"><span>{element.text}</span>{element.children?.map(child => <MenuPreview key={child.id} element={child}/>)}</div>;
}

export function WireframeNavigationInferenceDialog({ screens, contextId, contextLabel, disabled = false, onClose, onApply }: Props) {
  const inputKey = useMemo(() => { try { return JSON.stringify(screens); } catch { return null; } },[screens]);
  const [extended,setExtended] = useState(false);
  const [reviewed,setReviewed] = useState(false);
  const analyze = (extendedMode = extended): Snapshot => {
    try {
      if (inputKey === null) throw new Error('화면 정보가 올바르지 않아 분석하지 못했습니다.');
      return {analysis:inferNavigationCandidates(screens,{extended:extendedMode}),screens,contextId,contextLabel,inputKey,error:''};
    } catch (error) { return {analysis:null,screens,contextId,contextLabel,inputKey:inputKey || '',error:error instanceof Error ? error.message : '공통 영역을 분석하지 못했습니다.'}; }
  };
  const [snapshot,setSnapshot] = useState<Snapshot>(analyze);
  const [selected,setSelected] = useState<Record<string,string[]>>(() => initialSelection(snapshot.analysis));
  const [error,setError] = useState('');
  const candidates = snapshot.analysis?.candidates || [];
  const skipped = snapshot.analysis?.skipped || [];
  const stale = snapshot.contextId !== contextId || snapshot.inputKey !== inputKey || snapshot.analysis?.options.extended !== extended;
  const selections = candidates.map(candidate => ({candidateId:candidate.id,targetScreenIds:candidate.targetScreenIds.filter(id => selected[candidate.id]?.includes(id)),allowChanges:reviewed})).filter(selection => selection.targetScreenIds.length > 0);
  const hasChanges = candidates.some(candidate => candidate.targets.some(target => target.kind !== 'exact' && selected[candidate.id]?.includes(target.screenId)));
  const selectedCount = selections.reduce((count,selection) => count+selection.targetScreenIds.length,0);
  const totalCount = candidates.reduce((count,candidate) => count+candidate.targetScreenIds.length,0);
  const blocked = disabled || stale || !snapshot.analysis || selectedCount === 0 || (hasChanges && !reviewed);
  const screenName = (id: string) => snapshot.screens.find(screen => screen.id === id)?.name || '이전 화면';
  const skippedReasons = [...skipped.reduce((counts,item) => counts.set(item.reason,(counts.get(item.reason) || 0)+1),new Map<string,number>())];
  const reanalyze = (mode = extended) => { const next = analyze(mode); setSnapshot(next); setSelected(initialSelection(next.analysis)); setReviewed(false); setError(''); };
  const toggle = (candidateId: string,targetId: string,checked: boolean) => { setReviewed(false); setSelected(previous => ({...previous,[candidateId]:checked ? [...(previous[candidateId] || []),targetId] : (previous[candidateId] || []).filter(id => id !== targetId)})); };

  return <Modal title="공통 내비게이션 자동 분석" wide onClose={onClose}>
    <form className="wf-inference" onSubmit={event => {
      event.preventDefault(); if (blocked || !snapshot.analysis) return;
      setError('');
      try { if (onApply(snapshot.analysis,selections)) onClose(); else setError('공통 영역을 연결하지 못했습니다. 현재 화면 내용을 확인하고 다시 분석해 주세요.'); }
      catch (caught) { setError(caught instanceof Error ? caught.message : '공통 영역을 연결하지 못했습니다.'); }
    }}>
      <p className="wf-inference-intro">같은 기기의 화면에서 헤더, 사이드바, 푸터의 내용·구조·동작을 비교합니다. 선택한 영역을 연결하면 이후 기준 화면의 변경도 함께 반영됩니다.</p>
      <div className="wf-inference-context"><Layers size={14}/><span>{snapshot.contextLabel || '현재 화면 버전'}</span><small>로컬 분석 · Groq 요청 없음</small></div>
      <label className="wf-inference-extended"><input type="checkbox" aria-label="유사 메뉴와 없는 영역도 찾기" checked={extended} disabled={disabled} onChange={event => {setExtended(event.target.checked);reanalyze(event.target.checked);}}/><span>유사 메뉴와 없는 영역도 찾기<small>이동 대상이 같은 메뉴의 표현을 통합하거나, 없는 공통 영역을 추가하는 제안을 함께 보여줍니다.</small></span></label>
      {stale && <div className="wf-inference-stale" role="alert">분석 이후 화면 내용이나 버전이 변경되었습니다. 현재 화면으로 다시 분석한 뒤 연결해 주세요.</div>}
      <div className="wf-inference-toolbar"><span role="status">공통 영역 후보 {candidates.length}개 · 연결 대상 {totalCount}개</span><button type="button" className="secondary small" disabled={disabled} onClick={()=>reanalyze()}><RefreshCw size={12}/>다시 분석</button></div>
      {snapshot.error && <p className="wf-inference-error" role="alert">{snapshot.error}</p>}
      {candidates.length > 0 ? <>
        <div className="wf-inference-selection"><label><input type="checkbox" aria-label="공통 영역 후보 전체 선택" checked={selectedCount > 0 && selectedCount === totalCount} disabled={disabled || stale} onChange={event => {setSelected(event.target.checked ? initialSelection(snapshot.analysis,true) : {});setReviewed(false);}}/>전체 선택</label><span>{selectedCount}개 연결 선택</span></div>
        <div className="wf-inference-candidates" role="group" aria-label="공통 내비게이션 연결 후보">
          {candidates.map(candidate => <fieldset key={candidate.id} className="wf-inference-candidate" data-testid={`navigation-candidate-${candidate.id}`} disabled={disabled || stale}>
            <legend>{wireDevices[candidate.device].label} · {navigationRegionLabels[candidate.region]}</legend>
            <div className="wf-inference-source"><small>기준 화면</small><strong>{screenName(candidate.sourceScreenId)}</strong><ArrowRight size={13}/><span>선택한 화면과 연결</span></div>
            <ul className="wf-inference-reasons">{candidate.reasons.map((reason,index) => <li key={`${index}:${reason}`}>{reason}</li>)}</ul>
            {candidate.sourceChanges?.length ? <div className="wf-inference-source-changes"><strong>기준 화면에도 적용되는 변경</strong><Differences items={candidate.sourceChanges}/>{candidate.sourcePreview && <MenuPreview element={candidate.sourcePreview}/>}</div> : null}
            {!candidate.sourceChanges?.length && candidate.sourcePreview && <div className="wf-inference-source-changes" aria-label="추가할 공통 영역 미리보기"><strong>추가할 공통 영역 미리보기</strong><MenuPreview element={candidate.sourcePreview}/></div>}
            <div className="wf-inference-targets">{candidate.targets.map(target => <div key={target.screenId} className="wf-inference-target"><label><input type="checkbox" aria-label={`${navigationRegionLabels[candidate.region]}: ${screenName(candidate.sourceScreenId)} → ${screenName(target.screenId)} 연결`} data-testid={`navigation-inference-target-${candidate.region}-${target.screenId}`} checked={!!selected[candidate.id]?.includes(target.screenId)} onChange={event => toggle(candidate.id,target.screenId,event.target.checked)}/><span>{screenName(target.screenId)}</span><small>{kindLabels[target.kind]}</small></label>{target.differences.length > 0 && <Differences items={target.differences}/>}</div>)}</div>
          </fieldset>)}
        </div>
        <p className="wf-inference-help">{extended?'선택한 제안에 표시된 메뉴 표현과 공통 영역만 변경합니다. 각 화면의 본문은 유지됩니다.':'현재 요소와 본문을 그대로 두고 동기화 연결만 추가합니다.'} 연결한 영역은 기준 화면에서 편집하며, 개별 편집하려면 연결을 해제할 수 있습니다.</p>
        {hasChanges && <label className="wf-inference-confirm"><input type="checkbox" aria-label="선택한 영역의 변경 내용을 확인했습니다" checked={reviewed} disabled={disabled || stale} onChange={event => setReviewed(event.target.checked)}/><span>선택한 영역의 변경 내용을 확인했습니다<small>표시된 메뉴 표현 변경과 새 영역 생성을 적용합니다.</small></span></label>}
      </> : !snapshot.error && <div className="wf-inference-empty"><Search size={24}/><strong>자동으로 연결할 공통 영역이 없습니다.</strong><p>내용·구조·동작이 다른 영역이나 이미 연결된 영역은 새 후보로 제안하지 않습니다. 기준 화면에서 ‘공통 내비게이션 적용’을 열어 직접 복사하거나 연결할 수 있습니다.</p></div>}
      {skipped.length > 0 && <details className="wf-inference-skipped"><summary>후보에서 제외된 영역 {skipped.length}개</summary><ul>{skippedReasons.map(([reason,count]) => <li key={reason}><span>{reason}</span><strong>{count}개</strong></li>)}</ul><div>{skipped.map((item,index) => <p key={`${item.screenId}:${item.region}:${index}`}><strong>{screenName(item.screenId)} · {navigationRegionLabels[item.region]}</strong><span>{item.reason}</span></p>)}</div></details>}
      {error && <p className="wf-inference-error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="secondary" type="button" onClick={onClose}>취소</button><button className="primary" type="submit" disabled={blocked}><Link2 size={14}/>선택한 공통 영역 연결</button></div>
    </form>
  </Modal>;
}
