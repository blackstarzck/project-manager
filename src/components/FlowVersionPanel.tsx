import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, GitBranch, Layers, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FlowGroup, FlowVersion, Project } from '../../shared/schema';
import { api } from '../api';
import { ActionMenu, Modal } from './ui';
import { ArchiveConfirmation, VersionTrashDialog } from './VersionTrashDialog';
import './flow-versions.css';

type Edit = { kind: 'new-group' | 'copy-group' | 'copy-version' | 'rename-group' | 'rename-version'; groupId?: string; versionId?: string; name: string };
export type ProjectMutation = (operation: (project: Project) => Promise<Project>) => Promise<Project>;
function FlowActions({ label, busy, items }: { label: string; busy: boolean; items: ComponentProps<typeof ActionMenu>['items'] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  return <ActionMenu trigger={<button ref={trigger} className="icon-button" disabled={busy} aria-label={label}><MoreHorizontal size={16}/></button>} items={items.map(item => ({ ...item, disabled: busy || item.disabled, onSelect: () => {
    // Let the menu release its focus trap before opening a modal from this stable trigger.
    requestAnimationFrame(() => { if (trigger.current?.isConnected && !trigger.current.disabled) { trigger.current.focus(); item.onSelect(); } });
  } }))}/>;
}
export function FlowVersionPanel({ project, mutate, busy, copyRequest }: { project: Project; mutate: ProjectMutation; busy: boolean; copyRequest: number }) {
  const [collapsed, setCollapsed] = useState<string[]>([]), [edit, setEdit] = useState<Edit | null>(null), [error, setError] = useState('');
  const [trashOpen,setTrashOpen] = useState(false), [archiveTarget,setArchiveTarget] = useState<{kind:'group'|'flow';id:string;name:string}|null>(null);
  const groups = (project.flowGroups || []).filter(group => !group.archivedAt), activeGroup = groups.find(group => group.versions.some(version => version.id === project.selectedFlowVersionId));
  const active = activeGroup?.versions.find(version => version.id === project.selectedFlowVersionId);
  useEffect(() => { if (copyRequest > 0 && active && activeGroup) setEdit({ kind: 'copy-version', groupId: activeGroup.id, versionId: active.id, name: `${active.name} 수정본` }); }, [copyRequest]);
  const perform = async (operation: (project: Project) => Promise<Project>) => { setError(''); try { await mutate(operation); setEdit(null); return true; } catch (e) { setError((e as Error).message); return false; } };
  const select = (versionId: string) => { if (versionId !== project.selectedFlowVersionId) void perform(current => api.selectFlowVersion(current,versionId)); };
  const openCopy = (group: FlowGroup, version: FlowVersion) => { setEdit({ kind: 'copy-version', groupId: group.id, versionId: version.id, name: `${version.name} 수정본` }); };
  const submit = () => { if (!edit?.name.trim()) return; void perform(current => { const name = edit.name.trim(); if (edit.kind === 'new-group') return api.createFlowGroup(current,name); if (edit.kind === 'copy-group') return api.createFlowGroup(current,name,edit.versionId); if (edit.kind === 'copy-version') return api.createFlowVersion(current,edit.groupId!,name,edit.versionId); if (edit.kind === 'rename-group') return api.renameFlowGroup(current,edit.groupId!,name); return api.renameFlowVersion(current,edit.versionId!,name); }); };
  const modalTitle = edit?.kind === 'new-group' ? '새 유저플로우' : edit?.kind === 'copy-group' ? '새 플로우 그룹으로 분기' : edit?.kind === 'copy-version' ? '현재 버전 복제' : '이름 변경';
  return <aside className="flow-version-panel" aria-label="플로우 목록"><div className="flow-version-panel-title"><strong>플로우 목록</strong><span>{groups.length}</span></div><button className="primary small flow-version-create" onClick={() => setEdit({ kind: 'new-group', name: '' })} disabled={busy}><Plus size={13}/>새 유저플로우</button><div className="flow-group-list">
    {!groups.length && <div className="flow-versions-empty"><GitBranch size={24}/><p>목적에 따라 플로우를 나누고<br/>수정본을 보관할 수 있어요.</p><span>현재 문서는 그대로 유지됩니다.</span></div>}
    {groups.map(group => <section className="flow-group" key={group.id}><div className="flow-group-header"><button className="flow-group-toggle" aria-label={`${group.name} ${collapsed.includes(group.id) ? '펼치기' : '접기'}`} onClick={() => setCollapsed(previous => previous.includes(group.id) ? previous.filter(id => id !== group.id) : [...previous,group.id])}>{collapsed.includes(group.id) ? <ChevronRight size={12}/> : <ChevronDown size={12}/>}<strong>{group.name}</strong></button><div className="flow-version-menu-container"><FlowActions label={`${group.name} 그룹 메뉴`} busy={busy} items={[
      { id: 'rename', label: '이름 변경', icon: <Pencil size={14}/>, onSelect: () => setEdit({kind:'rename-group',groupId:group.id,name:group.name}) },
      { id: 'branch', label: '새 그룹으로 분기', icon: <GitBranch size={14}/>, onSelect: () => { const source = group.versions.find(version => version.id === project.selectedFlowVersionId) || group.versions.filter(version => !version.archivedAt).at(-1); if (source) setEdit({kind:'copy-group',versionId:source.id,name:`${group.name} 복사`}); } },
      { id: 'archive', label: '그룹 휴지통으로 이동', icon: <Trash2 size={14}/>, danger: true, onSelect: () => { setError(''); setArchiveTarget({kind:'group',id:group.id,name:group.name}); } },
    ]}/></div></div>
      {!collapsed.includes(group.id) && <div className="flow-version-list">{group.versions.filter(version => !version.archivedAt).map(version => { const isActive = version.id === project.selectedFlowVersionId; const flow = isActive ? project.flow : version.flow; const screens = isActive ? project.wireframes : version.wireframes; return <div className={`flow-version-row ${isActive ? 'active' : ''}`} key={version.id}><button className="flow-version-select" aria-label={`${group.name} / ${version.name} 선택`} aria-pressed={isActive} disabled={busy} onClick={() => select(version.id)}><div className="flow-version-name"><span className="flow-version-badge">v{version.number}</span><strong>{version.name}</strong>{isActive && <Check size={11}/>}</div><div className="flow-version-meta">{new Date(version.updatedAt).toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'})}<span>·</span>{flow.nodes.length ? `페이지 ${flow.nodes.filter(node => node.type === 'page').length}` : '빈 플로우'}{screens.length > 0 && <><span>·</span>화면 {screens.length}</>}</div></button><div className="flow-version-menu-container"><FlowActions label={`${version.name} 버전 메뉴`} busy={busy} items={[
        { id: 'copy', label: '현재 버전 복제', icon: <Copy size={14}/>, onSelect: () => openCopy(group,version) },
        { id: 'archive', label: '플로우 버전 휴지통으로 이동', icon: <Trash2 size={14}/>, danger: true, onSelect: () => { setError(''); setArchiveTarget({kind:'flow',id:version.id,name:version.name}); } },
        { id: 'rename', label: '이름 변경', icon: <Pencil size={14}/>, onSelect: () => setEdit({kind:'rename-version',versionId:version.id,name:version.name}) },
        { id: 'branch', label: '새 그룹으로 분기', icon: <GitBranch size={14}/>, onSelect: () => setEdit({kind:'copy-group',versionId:version.id,name:`${group.name} 분기`}) },
      ]}/></div></div>; })}</div>}
    </section>)}
  </div>{error && <p className="flow-version-error" role="alert">{error}</p>}<div className="flow-version-footer"><span><GitBranch size={11}/>플로우 {groups.length}</span><span><Layers size={11}/>버전 {groups.reduce((total,group) => total+group.versions.filter(version => !version.archivedAt).length,0)}</span></div>
  <button className="flow-version-trash" aria-label="버전 휴지통 열기" onClick={() => setTrashOpen(true)}><Trash2 size={12}/>버전 휴지통</button>
  {trashOpen && <VersionTrashDialog project={project} mutate={mutate} busy={busy} onClose={() => setTrashOpen(false)}/>}
  {archiveTarget && <ArchiveConfirmation name={archiveTarget.name} description={archiveTarget.kind === 'group' ? '그룹과 하위 플로우·화면 버전이 목록에서 숨겨집니다.' : '이 플로우 버전과 하위 화면 버전이 목록에서 숨겨집니다.'} busy={busy} error={error} onClose={() => setArchiveTarget(null)} onConfirm={() => {void perform(current => archiveTarget.kind === 'group' ? api.archiveFlowGroup(current,archiveTarget.id,true) : api.archiveFlowVersion(current,archiveTarget.id,true)).then(ok => {if(ok)setArchiveTarget(null);});}}/>}
  {edit && <Modal title={modalTitle} busy={busy} onClose={() => { if (!busy) setEdit(null); }}><form onSubmit={event => {event.preventDefault();submit();}}><p className="help-copy">{edit.kind === 'new-group' ? '새로운 사용자 여정을 위한 빈 플로우를 만듭니다. 기존 그룹과 버전은 유지됩니다.' : edit.kind === 'copy-version' ? '선택한 플로우와 연결된 와이어프레임을 그대로 복제합니다. AI를 사용하지 않고 별도의 사본을 만들어요.' : edit.kind === 'copy-group' ? '선택한 버전을 별도 그룹에 복제합니다. 이후 두 플로우를 독립적으로 편집할 수 있어요.' : '목록에서 알아보기 쉬운 이름으로 변경하세요.'}</p><label className="form-field">{edit.kind.includes('group') ? '플로우 이름' : '버전 이름'}<input autoFocus required disabled={busy} maxLength={120} aria-label={edit.kind.includes('group') ? '플로우 이름' : '버전 이름'} value={edit.name} onChange={event => setEdit({...edit,name:event.target.value})} placeholder={edit.kind.includes('group') ? '예: 회원가입 및 온보딩' : '예: 예외 흐름 보완'}/></label>{error && <p className="flow-version-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary" type="button" disabled={busy} onClick={() => setEdit(null)}>취소</button><button className="primary" type="submit" disabled={busy || !edit.name.trim()}>{busy ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>} {edit.kind.startsWith('rename') ? '이름 저장' : edit.kind === 'copy-version' ? '현재 버전 복제' : '플로우 만들기'}</button></div></form></Modal>}
  </aside>;
}
