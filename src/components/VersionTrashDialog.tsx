import { useState } from 'react';
import { ArchiveRestore, LoaderCircle, Trash2 } from 'lucide-react';
import type { Project } from '../../shared/schema';
import { api } from '../api';
import type { ProjectMutation } from './FlowVersionPanel';
import { Modal } from './ui';
import './version-trash.css';

export function VersionTrashDialog({ project, mutate, busy, onClose }: { project: Project; mutate: ProjectMutation; busy: boolean; onClose: () => void }) {
  const [error, setError] = useState('');
  const items: {id:string;kind:'group'|'flow'|'wireframe';label:string;parentArchived:boolean;flowId?:string;date:string}[] = [];
  for (const group of project.flowGroups) {
    if (group.archivedAt) items.push({id:group.id,kind:'group',label:group.name,parentArchived:false,date:group.archivedAt});
    for (const flow of group.versions) {
      if (flow.archivedAt) items.push({id:flow.id,kind:'flow',label:`${group.name} / ${flow.name}`,parentArchived:!!group.archivedAt,date:flow.archivedAt});
      for (const version of flow.wireframeVersions) if (version.archivedAt) items.push({id:version.id,kind:'wireframe',label:`${group.name} / ${flow.name} / ${version.name}`,parentArchived:!!group.archivedAt || !!flow.archivedAt,flowId:flow.id,date:version.archivedAt});
    }
  }
  const restore = async (item:typeof items[number]) => { setError(''); try { await mutate(current => item.kind === 'group' ? api.archiveFlowGroup(current,item.id,false) : item.kind === 'flow' ? api.archiveFlowVersion(current,item.id,false) : api.archiveWireframeVersion(current,item.flowId!,item.id,false)); } catch (caught) { setError((caught as Error).message); } };
  return <Modal busy={busy} title="버전 휴지통" wide onClose={() => { if (!busy) onClose(); }}><p className="help-copy">그룹, 플로우 버전, 화면 버전을 복원할 수 있습니다. 상위 그룹이나 플로우가 휴지통에 있으면 먼저 복원해 주세요. 복원한 항목은 목록에서 선택할 수 있습니다.</p>
    <div className="version-trash-list">{items.length ? items.map(item => <div className="version-trash-row" key={`${item.kind}:${item.id}`}><Trash2 size={14}/><div><small>{item.kind === 'group' ? '플로우 그룹' : item.kind === 'flow' ? '플로우 버전' : '화면 버전'} · {new Date(item.date).toLocaleDateString('ko-KR')}</small><strong>{item.label}</strong>{item.parentArchived && <span>상위 항목을 먼저 복원해 주세요.</span>}</div><button className="secondary small" data-testid={`restore-${item.kind}-${item.id}`} aria-label={`${item.label} 복원`} disabled={busy || item.parentArchived} onClick={() => void restore(item)}>{busy ? <LoaderCircle size={12} className="spin"/> : <ArchiveRestore size={13}/>}복원</button></div>) : <p className="version-trash-empty">휴지통이 비어 있습니다.</p>}</div>
    {error && <p className="version-trash-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary" disabled={busy} onClick={onClose}>닫기</button></div>
  </Modal>;
}

export function ArchiveConfirmation({ name, description, busy, error, onClose, onConfirm }: { name:string;description:string;busy:boolean;error:string;onClose:()=>void;onConfirm:()=>void }) {
  return <Modal busy={busy} title="버전을 휴지통으로 이동" onClose={() => { if (!busy) onClose(); }}><p className="help-copy"><strong>{name}</strong><br/>{description}<br/>버전 휴지통에서 복원할 수 있습니다. 마지막으로 남은 활성 항목은 이동할 수 없습니다.</p>{error && <p className="version-trash-error" role="alert">{error}</p>}<div className="modal-footer"><button className="secondary" disabled={busy} onClick={onClose}>취소</button><button className="danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={13} className="spin"/> : <Trash2 size={13}/>}휴지통으로 이동</button></div></Modal>;
}
