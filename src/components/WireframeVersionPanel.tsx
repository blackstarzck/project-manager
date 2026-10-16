import { useState } from 'react';
import { Check, Copy, History, LoaderCircle, Pencil, Trash2 } from 'lucide-react';
import type { Project } from '../../shared/schema';
import { api } from '../api';
import type { ProjectMutation } from './FlowVersionPanel';
import { Modal } from './ui';
import { ArchiveConfirmation, VersionTrashDialog } from './VersionTrashDialog';
import './wireframe-versions.css';

export function WireframeVersionPanel({ project, mutate, busy }: { project: Project; mutate: ProjectMutation; busy: boolean }) {
  const flow = project.flowGroups.flatMap(group => group.versions).find(version => version.id === project.selectedFlowVersionId);
  const versions = (flow?.wireframeVersions || []).filter(version => !version.archivedAt);
  const active = versions.find(version => version.id === project.selectedWireframeVersionId);
  const [edit, setEdit] = useState<{ kind: 'copy' | 'rename'; versionId: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [trashOpen,setTrashOpen] = useState(false), [archiveOpen,setArchiveOpen] = useState(false);
  const perform = async (operation: (current: Project) => Promise<Project>) => { setError(''); try { await mutate(operation); setEdit(null); setArchiveOpen(false); } catch (caught) { setError((caught as Error).message); } };
  return <section className="wf-version-panel" aria-label="와이어프레임 버전 관리">
    <div className="wf-version-row"><label htmlFor="wireframe-version"><History size={14}/>화면 버전</label><select id="wireframe-version" aria-label="와이어프레임 버전 선택" value={project.selectedWireframeVersionId || ''} disabled={busy || !flow} onChange={event => { const id = event.target.value; if (flow && id !== project.selectedWireframeVersionId) void perform(current => api.selectWireframeVersion(current,flow.id,id)); }}>
      {!active && <option value="" disabled>화면 버전 없음</option>}{versions.map(version => <option key={version.id} value={version.id}>v{version.number} · {version.name} · {version.id === active?.id ? project.wireframes.length : version.wireframes.length}개 화면</option>)}
    </select><span className="wf-version-date">{active ? new Date(active.updatedAt).toLocaleDateString('ko-KR') : ''}</span><div className="wf-version-actions"><button className="secondary small" disabled={!active || busy} onClick={() => { if (active) setEdit({ kind:'copy',versionId:active.id,name:`${active.name} 복사`.slice(0,120) }); }}><Copy size={12}/>화면 버전 복제</button><button className="icon-button" aria-label="화면 버전 이름 변경" title="화면 버전 이름 변경" disabled={!active || busy} onClick={() => { if (active) setEdit({kind:'rename',versionId:active.id,name:active.name}); }}><Pencil size={13}/></button><button className="icon-button" aria-label="화면 버전 휴지통으로 이동" title="화면 버전 휴지통으로 이동" disabled={!active || busy} onClick={() => {setError('');setArchiveOpen(true);}}><Trash2 size={13}/></button><button className="secondary small" aria-label="버전 휴지통 열기" onClick={() => setTrashOpen(true)}>휴지통</button></div></div>
    {error && <p className="wf-version-error" role="alert">{error}</p>}
    {trashOpen && <VersionTrashDialog project={project} mutate={mutate} busy={busy} onClose={() => setTrashOpen(false)}/>}
    {archiveOpen && active && flow && <ArchiveConfirmation name={active.name} description="이 화면 버전을 목록에서 숨깁니다. 연결된 플로우와 다른 화면 버전은 유지됩니다." busy={busy} error={error} onClose={() => setArchiveOpen(false)} onConfirm={() => void perform(current => api.archiveWireframeVersion(current,flow.id,active.id,true))}/>}
    {edit && flow && <Modal busy={busy} title={edit.kind === 'copy' ? '와이어프레임 버전 복제' : '화면 버전 이름 변경'} onClose={() => { if (!busy) setEdit(null); }}><form onSubmit={event => { event.preventDefault(); if (!edit.name.trim()) return; void perform(current => edit.kind === 'copy' ? api.createWireframeVersion(current,flow.id,edit.name.trim(),edit.versionId) : api.renameWireframeVersion(current,flow.id,edit.versionId,edit.name.trim())); }}>
      <p className="help-copy">{edit.kind === 'copy' ? '현재 화면 구성과 연결을 별도의 버전으로 복제합니다. 같은 플로우 안에서 두 버전을 독립적으로 편집할 수 있어요.' : '이 플로우의 화면 버전을 알아보기 쉬운 이름으로 바꾸세요.'}</p><label className="form-field">화면 버전 이름<input aria-label="화면 버전 이름" value={edit.name} onChange={event => setEdit({...edit,name:event.target.value})} maxLength={120} autoFocus required/></label>
      {error && <p className="wf-version-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary" type="button" disabled={busy} onClick={() => setEdit(null)}>취소</button><button className="primary" type="submit" disabled={busy || !edit.name.trim()}>{busy ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>} {edit.kind === 'copy' ? '화면 버전 복제' : '이름 저장'}</button></div>
    </form></Modal>}
  </section>;
}
