import { GitBranch, LoaderCircle } from 'lucide-react';
import type { Project } from '../../shared/schema';
import './flow-context.css';

export function FlowContextBar({ project, busy, onSwitch, onError }: { project: Project; busy: boolean; onSwitch: (versionId: string) => Promise<Project>; onError: (message: string) => void }) {
  const group = project.flowGroups.find(item => item.versions.some(version => version.id === project.selectedFlowVersionId));
  const active = group?.versions.find(version => version.id === project.selectedFlowVersionId);
  return <div className="flow-context-bar" role="group" aria-label="와이어프레임 플로우 버전">
    <label htmlFor="wireframe-flow-version"><GitBranch size={14}/>플로우 버전</label>
    <select id="wireframe-flow-version" aria-label="와이어프레임 플로우 버전 선택" value={project.selectedFlowVersionId || ''} disabled={busy} onChange={event => { const id = event.target.value; if (id !== project.selectedFlowVersionId) void onSwitch(id).catch(error => onError((error as Error).message)); }}>
      {!active && <option value="" disabled>버전을 선택해 주세요</option>}
      {project.flowGroups.filter(item => !item.archivedAt).map(item => <optgroup label={item.name} key={item.id}>{item.versions.filter(version => !version.archivedAt).map(version => <option key={version.id} value={version.id}>{item.name} / {version.name} · v{version.number}</option>)}</optgroup>)}
    </select>
    <span className="flow-context-summary">{busy ? <><LoaderCircle size={12} className="spin"/>저장 후 전환 중…</> : <>이 버전의 화면 {project.wireframes.length}개</>}</span>
  </div>;
}
