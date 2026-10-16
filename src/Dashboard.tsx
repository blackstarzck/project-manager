import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, Folder, FolderPlus, LayoutGrid, MoreHorizontal, Plus, Search, Settings, Sparkles, Trash2, Upload, RotateCcw, ChevronDown, FileText } from 'lucide-react';
import type { Project, ProjectSummary, AiStatus } from '../shared/schema';
import { api } from './api';
import { ActionMenu, Brand, Button, dateLabel, EmptyState, ErrorBanner, Loading, Modal, TextField } from './components/ui';

export function Dashboard({ onOpen }: { onOpen: (project: Project) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]), [loading, setLoading] = useState(true);
  const [archived, setArchived] = useState(false), [query, setQuery] = useState(''), [error, setError] = useState('');
  const [create, setCreate] = useState(false), [settings, setSettings] = useState(false);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const listRequest = useRef(0);
  const refresh = async () => { const request = ++listRequest.current; setLoading(true); try { const next = await api.projects(archived); if (request === listRequest.current) setProjects(next); } catch (e) { if (request === listRequest.current) setError((e as Error).message); } finally { if (request === listRequest.current) setLoading(false); } };
  useEffect(() => { void refresh(); return () => { listRequest.current++; }; }, [archived]);
  useEffect(() => { void api.status().then(setStatus).catch(() => undefined); }, []);
  const perform = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const shown = projects.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="dashboard"><a className="skip-link" href="#dashboard-content" onClick={event => { event.preventDefault(); document.getElementById('dashboard-content')?.focus(); }}>프로젝트 목록으로 건너뛰기</a>
    <aside className="dashboard-nav"><Brand/><div className="workspace-selector"><span className="workspace-avatar">P</span><div><strong>내 워크스페이스</strong><small>Personal workspace</small></div><ChevronDown size={13} className="muted" style={{ marginLeft: 'auto' }}/></div>
      <p className="eyebrow">워크스페이스</p>
      <button className={`nav-item ${!archived ? 'active' : ''}`} onClick={() => setArchived(false)}><LayoutGrid size={16}/>모든 프로젝트{!archived && <span className="nav-count">{projects.length}</span>}</button>
      <button className={`nav-item ${archived ? 'active' : ''}`} onClick={() => setArchived(true)}><Trash2 size={16}/>휴지통</button>
      <div className="nav-bottom"><button className="nav-item" onClick={() => file.current?.click()}><Upload size={16}/>백업 가져오기</button><button className="nav-item" onClick={() => setSettings(true)}><Settings size={16}/>연결 및 설정</button><div className="local-status"><span className="status-dot"/>내 PC에 안전하게 저장 중</div></div>
    </aside>
    <main className="dashboard-main" id="dashboard-content" tabIndex={-1}><header className="dashboard-topbar"><span>워크스페이스 <span style={{ padding: '0 10px' }}>/</span> {archived ? '휴지통' : '프로젝트'}</span><span className="user-avatar">ME</span></header>
      {error && <ErrorBanner message={error} onClose={() => setError('')}/>}
      <div className="dashboard-heading"><div><h1>{archived ? '휴지통' : '나의 프로젝트'}</h1><p>{archived ? '삭제한 프로젝트를 복원하고 이어서 작업하세요.' : '흩어진 아이디어를, 하나의 명확한 기획으로.'}</p></div>{!archived && <button className="primary" onClick={() => {setError('');setCreate(true);}}><Plus size={16}/>새 프로젝트</button>}</div>
      {!archived && projects.length === 0 && !loading && <div className="welcome-panel"><div className="welcome-art"><FileText size={37} strokeWidth={1.2}/></div><div><h2>좋은 기획은 작은 아이디어에서 시작해요</h2><p>AI와 함께 요구사항을 정리하고, 기능과 사용자 흐름을 연결해 보세요.<br/>생각부터 클릭할 수 있는 화면까지, 한곳에서 만들 수 있어요.</p><div className="onboarding-steps">{['아이디어 정리', '기능 구체화', '흐름과 화면'].map((s,i) => <span className="onboarding-step" key={s}><b>{i+1}</b>{s}{i<2 && <ArrowRight size={10}/>}</span>)}</div></div></div>}
      <div className="dashboard-toolbar"><strong>{archived ? '삭제된 프로젝트' : '전체 프로젝트'}<span>{shown.length}</span></strong><div className="search-field"><Search size={14}/><input aria-label="프로젝트 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="프로젝트 검색"/></div></div>
      {loading ? <Loading/> : shown.length ? <div className="project-grid">{shown.map(p => <article className="project-card" key={p.id}>
        <button className="project-card-open" aria-label={`${p.name} 프로젝트 열기`} disabled={busy || archived} onClick={() => void perform(async () => onOpen(await api.project(p.id)))}/>
        <div className="project-card-icon"><Folder size={20}/></div><h2>{p.name}</h2><p>{p.description || '프로젝트의 첫 이야기를 작성해 보세요.'}</p><div className="project-card-footer"><span>{dateLabel(p.updatedAt)} 수정</span><span>기능 {p.counts.features} · 화면 {p.counts.screens}</span></div>
        <div className="project-card-menu"><ActionMenu trigger={<button className="icon-button" disabled={busy} aria-label={`${p.name} 프로젝트 메뉴`}><MoreHorizontal size={18}/></button>} items={archived ? [{id:'restore',label:'프로젝트 복원',icon:<RotateCcw size={16}/>,onSelect:()=>void perform(async()=>{await api.patch(await api.project(p.id),{archived:false});await refresh();})}] : [{id:'duplicate',label:'프로젝트 복제',icon:<Copy size={16}/>,onSelect:()=>void perform(async()=>{await api.duplicate(p.id);await refresh();})},{id:'archive',label:'휴지통으로 이동',icon:<Trash2 size={16}/>,danger:true,onSelect:()=>void perform(async()=>{await api.patch(await api.project(p.id),{archived:true});await refresh();})}]}/></div>
      </article>)}</div> : (archived || query) ? <EmptyState icon={<Folder size={26}/>} title={query ? '검색 결과가 없어요' : '휴지통이 비어 있어요'}>{query ? '다른 검색어를 입력하거나 검색 내용을 지워 보세요.' : '프로젝트를 삭제하면 이곳에서 다시 복원할 수 있어요.'}</EmptyState> : <EmptyState icon={<FolderPlus size={27}/>} title="첫 프로젝트를 만들어 보세요" action={<button className="primary" onClick={() => {setError('');setCreate(true);}}><Plus size={15}/>프로젝트 만들기</button>}>만들고 싶은 서비스나 제품을 한 줄로 설명해 주세요. 나머지는 함께 구체화해 나가면 돼요.</EmptyState>}
    </main>
    <input ref={file} type="file" accept="application/json,.json" aria-label="프로젝트 백업 파일" hidden onChange={e => { const selected = e.target.files?.[0]; if (selected) void perform(async () => onOpen(await api.restoreBackup(JSON.parse(await selected.text())))); e.target.value = ''; }}/>
    {create && <Modal title="새 프로젝트 만들기" busy={busy} onClose={() => setCreate(false)}>{error && <ErrorBanner message={error} onClose={() => setError('')}/>}<p className="help-copy">어떤 아이디어를 실현하고 싶으신가요?</p><form onSubmit={e => { e.preventDefault(); void perform(async () => { const p = await api.create(name.trim(), description.trim()); setCreate(false); onOpen(p); }); }}><TextField label="프로젝트 이름" autoFocus required maxLength={120} autoComplete="off" placeholder="예: 우리 동네 산책 메이트" value={name} onChange={e => setName(e.target.value)}/><label className="form-field">프로젝트 설명<span className="field-help">누구를 위한 서비스인지, 어떤 문제를 해결하는지 적어 주세요.</span><textarea aria-label="프로젝트 설명" rows={4} maxLength={5000} value={description} onChange={e => setDescription(e.target.value)} placeholder="가까운 이웃과 함께 산책할 수 있는 서비스를 만들고 싶어요."/></label><div className="modal-footer"><Button variant="secondary" disabled={busy} onClick={() => setCreate(false)}>취소</Button><Button type="submit" loading={busy} disabled={!name.trim()}><Plus size={15}/>프로젝트 만들기</Button></div></form></Modal>}
    {settings && <Modal title="AI 연결 및 로컬 저장" onClose={() => setSettings(false)}><div className="run-card"><div className="run-card-header"><Sparkles size={16}/>Groq AI <span className={`badge ${status?.configured ? 'badge-green' : 'badge-orange'}`}>{status?.configured ? '연결 설정됨' : '키 설정 필요'}</span></div><p>{status?.model || '모델 설정을 확인하고 있습니다.'}</p></div><p className="help-copy">API 키는 로컬 서버의 환경 파일에서만 읽습니다. 생성 시 현재 프로젝트 내용을 Groq에 전달합니다. 문서는 내 PC의 SQLite 데이터베이스에 저장됩니다.</p><p className="field-help">다른 PC로 옮기려면 프로젝트 안에서 백업을 내보낸 뒤, 백업 가져오기를 사용하세요.</p><div className="modal-footer"><button className="primary" onClick={() => setSettings(false)}><Check size={14}/>확인</button></div></Modal>}
  </div>;
}
