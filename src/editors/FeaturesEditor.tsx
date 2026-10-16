import { useMemo, useState } from 'react';
import { FileText, FolderTree, GitBranch, Layers, List, PanelLeft, PanelRight, Plus, Search, Sparkles, Star, Trash2, X } from 'lucide-react';
import type { Feature, Project } from '../../shared/schema';
import { EmptyState, Modal, uid } from '../components/ui';
import { FeatureGraph } from './FeatureGraph';
import { useEditorPanels } from './useEditorPanels';
import '../editor-layout.css';

const priorities = { high: '높음', medium: '중간', low: '낮음' };
const statuses = { backlog: '기획 작성중', planned: '기획 제안', review: '기획 확정', in_progress: '개발 중', done: '개발 완료', hold: '보류' };
const kinds = { requirement: '요구사항', feature: '기능', subfeature: '상세 기능' };
const symbols = { requirement: 'R', feature: 'F', subfeature: 'S' };
export function FeaturesEditor({ project, onChange, onAi }: { project: Project; onChange: (features: Feature[]) => void; onAi: (ids?: string[]) => void }) {
  const [view, setView] = useState<'tree' | 'directory' | 'document'>('tree');
  const [selected, setSelected] = useState<string | null>(null), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false), [newTitle, setNewTitle] = useState(''), [newParent, setNewParent] = useState('');
  const [docRoot, setDocRoot] = useState('');
  const panels = useEditorPanels({ leftWidth: 240, rightWidth: 340, minimum: view === 'tree' ? 600 : 640, leftAvailable: view !== 'document' && project.features.length > 0, rightAvailable: view === 'tree' && !!selected });
  const selectFeature = (id: string) => { setSelected(id); if (view === 'tree') panels.open('right'); };
  const features = project.features;
  const active = features.find(f => f.id === selected) || features[0];
  const patch = (id: string, values: Partial<Feature>) => onChange(features.map(f => f.id === id ? { ...f, ...values } : f));
  const sorted = useMemo(() => { const rows: { feature: Feature; depth: number }[] = []; const visit = (parentId: string | null, depth: number) => features.filter(f => f.parentId === parentId).forEach(feature => { rows.push({ feature, depth }); visit(feature.id, depth + 1); }); visit(null, 0); return rows; }, [features]);
  const matches = (f: Feature) => `${f.title} ${f.description}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'favorite' && f.favorite || f.priority === filter);
  const deleteFeature = (item: Feature) => {
    const descendants = new Set([item.id]);
    let changed = true;
    while (changed) {
      changed = false;
      features.forEach(feature => {
        if (feature.parentId && descendants.has(feature.parentId) && !descendants.has(feature.id)) {
          descendants.add(feature.id); changed = true;
        }
      });
    }
    const references = project.flowGroups.flatMap(group => group.versions.flatMap(version => {
      const flow = version.id === project.selectedFlowVersionId ? project.flow : version.flow;
      return flow.nodes.some(node => node.featureIds.some(id => descendants.has(id))) ? [`${group.name} / ${version.name} (v${version.number})`] : [];
    }));
    if (references.length) {
      alert(`다음 유저플로우 버전이 이 기능 또는 하위 기능을 참조하고 있습니다. 연결을 해제한 뒤 삭제해 주세요.\n\n${references.join('\n')}`);
      return;
    }
    if (confirm(`“${item.title}”과 하위 ${descendants.size - 1}개 항목을 삭제할까요?`)) {
      onChange(features.filter(feature => !descendants.has(feature.id))); setSelected(null);
    }
  };
  const add = () => { const parent = features.find(f => f.id === newParent); const item: Feature = { id: uid(), revision: 0, parentId: parent?.id || null, kind: parent?.kind === 'requirement' ? 'feature' : parent ? 'subfeature' : 'requirement', title: newTitle.trim(), description: '', priority: 'medium', status: 'backlog', roles: [], acceptanceCriteria: [], prdIds: [], favorite: false }; onChange([...features, item]); setSelected(item.id); setAdding(false); setNewTitle(''); setView('directory'); };
  const detail = (item: Feature, documentMode = false) => <div className={documentMode ? 'feature-document-section' : 'feature-detail'} key={item.id}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span className="badge"><span>{symbols[item.kind]}</span>{kinds[item.kind]}</span><div className="page-tools"><button className="icon-button" title="즐겨찾기" aria-label={`${item.title} 즐겨찾기`} onClick={() => patch(item.id, { favorite: !item.favorite })}><Star size={15} fill={item.favorite ? '#c6a060' : 'none'} color={item.favorite ? '#c6a060' : undefined}/></button><button className="icon-button" aria-label={`${item.title} 삭제`} onClick={() => deleteFeature(item)}><Trash2 size={15}/></button></div></div>
    <input className="title-input" aria-label="기능 제목" value={item.title} onChange={e => patch(item.id, { title: e.target.value || '새 기능' })}/>
    <div className="feature-properties"><label className="property">중요도<select aria-label="기능 중요도" value={item.priority} onChange={e => patch(item.id, { priority: e.target.value as Feature['priority'] })}>{Object.entries(priorities).map(([k,v]) => <option value={k} key={k}>{v}</option>)}</select></label><label className="property">상태<select aria-label="기능 상태" value={item.status} onChange={e => patch(item.id, { status: e.target.value as Feature['status'] })}>{Object.entries(statuses).map(([k,v]) => <option value={k} key={k}>{v}</option>)}</select></label></div>
    <h2>설명</h2><textarea aria-label="기능 설명" placeholder="이 기능의 목적과 동작을 설명해 주세요." rows={4} value={item.description} onChange={e => patch(item.id, { description: e.target.value })}/>
    <h2>수용 기준</h2>{item.acceptanceCriteria.map((criterion, i) => <div className="criteria-row" key={i}><span className="criteria-check"/><input aria-label={`수용 기준 ${i+1}`} value={criterion} placeholder="완료를 판단할 수 있는 조건" onChange={e => patch(item.id, { acceptanceCriteria: item.acceptanceCriteria.map((c,j) => j === i ? e.target.value : c) })}/><button className="icon-button" aria-label={`수용 기준 ${i+1} 삭제`} onClick={() => patch(item.id, { acceptanceCriteria: item.acceptanceCriteria.filter((_,j) => j !== i) })}><X size={13}/></button></div>)}<button className="text-button small" onClick={() => patch(item.id, { acceptanceCriteria: [...item.acceptanceCriteria, ''] })}><Plus size={12}/>수용 기준 추가</button>
    <h2>사용자 역할</h2><input style={{ width: '100%' }} aria-label="기능 사용자 역할" placeholder="기획자, 관리자 (쉼표로 구분)" value={item.roles.join(', ')} onChange={e => patch(item.id, { roles: e.target.value.split(',').map(v => v.trim()) })}/>
    <h2>연결된 PRD 항목</h2><div className="reference-checks">{project.prd.length ? project.prd.map(p => <label key={p.id}><input type="checkbox" checked={item.prdIds.includes(p.id)} onChange={e => patch(item.id, { prdIds: e.target.checked ? [...item.prdIds, p.id] : item.prdIds.filter(id => id !== p.id) })}/>{p.title}</label>) : <span className="field-help">PRD 항목을 작성하면 여기에서 연결할 수 있어요.</span>}</div>
    <div style={{ display: 'flex', gap: 8, marginTop: 24 }}><button className="secondary small" onClick={() => onAi([item.id])}><Sparkles size={13}/>AI로 구체화</button>{item.kind !== 'subfeature' && <button className="secondary small" onClick={() => { setNewParent(item.id); setAdding(true); }}><Plus size={13}/>하위 {item.kind === 'requirement' ? '기능' : '상세 기능'}</button>}</div>
  </div>;
  const root = docRoot || features.find(f => !f.parentId)?.id;
  const inDocument = (f: Feature): boolean => f.id === root || !!f.parentId && (f.parentId === root || features.find(parent => parent.id === f.parentId)?.parentId === root);
  return <div ref={panels.ref} className="features-editor ux-editor" data-preferred-reserved-width={panels.preferredReservedWidth} data-reserved-width={panels.reservedWidth} data-min-canvas-width={view === 'tree' ? 600 : 640}><div className="page-toolbar"><div className="page-title"><Layers size={15}/>기능명세<span className="pill">{features.length}</span></div><div className="page-tools">{features.length > 0 && view !== 'document' && <button id="feature-list-toggle" className="secondary small editor-panel-toggle" aria-label="기능 목록 표시" aria-expanded={panels.leftVisible} aria-controls="feature-list-panel" onClick={() => panels.toggle('left')}><PanelLeft size={15}/>목록</button>}{view === 'tree' && selected && <button id="feature-detail-toggle" className="secondary small editor-panel-toggle" aria-label="기능 속성 표시" aria-expanded={panels.rightVisible} aria-controls="feature-detail-panel" onClick={() => panels.toggle('right')}><PanelRight size={15}/>속성</button>}<div className="view-switch" role="group" aria-label="기능명세 보기">{([['tree',FolderTree,'그래프'],['directory',List,'디렉토리'],['document',FileText,'도큐먼트']] as const).map(([key,Icon,label]) => <button key={key} title={`${label} 뷰`} aria-label={`${label} 뷰`} aria-pressed={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}><Icon size={13}/>{label}</button>)}</div><button className="secondary small" onClick={() => { setNewParent(''); setAdding(true); }}><Plus size={13}/>추가</button></div></div>
    {!features.length ? <EmptyState icon={<GitBranch size={27}/>} title="아이디어를 기능으로 나눠 볼까요?" action={<div className="page-tools"><button className="primary" onClick={() => onAi()}><Sparkles size={14}/>AI로 기능명세 만들기</button><button className="secondary" onClick={() => setAdding(true)}><Plus size={14}/>직접 추가</button></div>}>PRD를 바탕으로 요구사항, 기능, 상세 기능을 연결해 보세요.</EmptyState> : <div className="feature-layout">
      {view !== 'document' && <aside id="feature-list-panel" aria-label="기능 목록" hidden={!panels.leftVisible} className={`feature-list ${panels.panelClass('left')}`} data-editor-panel="features-list" data-reserved-width={panels.leftDocked ? 240 : 0} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && event.currentTarget.contains(event.target as globalThis.Node) && !panels.leftDocked) { panels.close('left'); document.getElementById('feature-list-toggle')?.focus(); } }}><div className="editor-panel-heading">기능 목록<button className="icon-button" aria-label="기능 목록 접기" onClick={() => { panels.close('left'); document.getElementById('feature-list-toggle')?.focus(); }}><X size={15}/></button></div><div className="search-field"><Search size={13}/><input aria-label="기능 검색" placeholder="기능 검색" value={query} onChange={e => setQuery(e.target.value)}/></div><select aria-label="기능 필터" className="feature-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">전체 기능</option><option value="favorite">즐겨찾기</option><option value="high">중요도 높음</option><option value="medium">중요도 중간</option><option value="low">중요도 낮음</option></select>{sorted.filter(row => matches(row.feature)).map(({feature:f, depth}) => <button className={`feature-row ${active?.id === f.id ? 'active' : ''}`} aria-pressed={active?.id === f.id} key={f.id} style={{ paddingLeft: 8 + depth * 13 }} onClick={() => selectFeature(f.id)}><span className="feature-level">{symbols[f.kind]}</span><span className="feature-row-label">{f.title}</span>{f.favorite && <Star size={10} fill="#d7bf86" color="#d7bf86"/>}</button>)}</aside>}
      {view === 'tree' ? <><FeatureGraph name={project.name} features={features} selected={selected} onSelect={selectFeature}/>{selected && <div id="feature-detail-panel" role="complementary" aria-label="기능 속성" hidden={!panels.rightVisible} className={`feature-tree-detail scroll-content ${panels.panelClass('right')}`} data-editor-panel="features-properties" data-reserved-width={panels.rightDocked ? 340 : 0} onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && event.currentTarget.contains(event.target as globalThis.Node) && !panels.rightDocked) { panels.close('right'); document.getElementById('feature-detail-toggle')?.focus(); } }}><div className="editor-panel-heading">기능 속성<button className="icon-button" onClick={() => { panels.close('right'); document.getElementById('feature-detail-toggle')?.focus(); }} aria-label="상세 패널 닫기"><X size={15}/></button></div>{active && detail(active)}</div>}</> : view === 'document' ? <div className="scroll-content"><div className="document-page" data-export="features"><label className="form-field">요구사항<select aria-label="문서 요구사항 선택" value={root} onChange={e => setDocRoot(e.target.value)}>{features.filter(f => !f.parentId).map(f => <option value={f.id} key={f.id}>{f.title}</option>)}</select></label>{sorted.filter(({feature:f}) => inDocument(f)).map(({feature:f}) => detail(f,true))}</div></div> : <div className="scroll-content" data-export="features">{active && detail(active)}</div>}
    </div>}
    {adding && <Modal title="기능 항목 추가" onClose={() => setAdding(false)}><form onSubmit={e => { e.preventDefault(); add(); }}><label className="form-field">상위 항목<select aria-label="상위 항목" value={newParent} onChange={e => setNewParent(e.target.value)}><option value="">최상위 요구사항</option>{features.filter(f => f.kind !== 'subfeature').map(f => <option key={f.id} value={f.id}>{kinds[f.kind]} · {f.title}</option>)}</select></label><label className="form-field">항목 이름<input autoFocus required aria-label="새 기능 이름" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="예: 회원 관리"/></label><div className="modal-footer"><button className="secondary" type="button" onClick={() => setAdding(false)}>취소</button><button className="primary" type="submit" disabled={!newTitle.trim()}><Plus size={14}/>항목 추가</button></div></form></Modal>}
  </div>;
}
