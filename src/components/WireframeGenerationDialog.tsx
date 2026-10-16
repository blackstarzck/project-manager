import { useRef, useState } from 'react';
import { LayoutTemplate, Search, Sparkles } from 'lucide-react';
import type { Project, WireframeGenerationMode } from '../../shared/schema';
import { Modal } from './ui';
import './wireframe-generation.css';

type Mode = 'missing' | 'improve';
type Props = { project: Project; disabled?: boolean; onClose: () => void; onGenerate: (prompt: string, entityIds: string[], mode: WireframeGenerationMode) => void };
export const wireframeGenerationLabels: Record<WireframeGenerationMode, string> = { edit:'현재 화면 버전 편집', append:'미생성 화면 추가 · 새 버전', regenerate:'화면 재생성 · 새 버전' };
const labels: Record<Mode, string> = { missing: '미생성 페이지 추가', improve: '기존 화면 개선' };
const prompts: Record<Mode, string> = {
  missing: '선택한 플로우 페이지에만 새 와이어프레임을 만들어 주세요. 주요 내용, 입력 필드, 버튼과 화면 간 연결을 구성해 주세요. 이미 있는 화면과 선택하지 않은 페이지는 변경하지 마세요.',
  improve: '선택한 와이어프레임 화면만 개선해 주세요. 연결된 기능과 플로우를 반영하고 기존의 사용자 작성 내용과 화면 간 연결을 최대한 보존해 주세요. 선택하지 않은 화면은 변경하지 마세요.',
};

export function WireframeGenerationDialog({ project, disabled = false, onClose, onGenerate }: Props) {
  const contextId = `${project.selectedFlowVersionId}:${project.selectedWireframeVersionId}`;
  const origin = useRef(contextId);
  const pages = project.flow.nodes.filter(node => node.type === 'page');
  const missing = pages.filter(node => !project.wireframes.some(screen => screen.flowNodeId === node.id));
  const [mode, setMode] = useState<Mode>(() => missing.length ? 'missing' : 'improve');
  const [selection, setSelection] = useState<Record<Mode, string[]>>(() => ({ missing: missing.map(node => node.id), improve: project.wireframes.map(screen => screen.id) }));
  const [instruction, setInstruction] = useState('');
  const [newVersion, setNewVersion] = useState(true);
  const [query, setQuery] = useState('');
  const choices = mode === 'missing' ? missing.map(node => ({ id: node.id, name: node.label, sectionId: node.sectionId })) : project.wireframes.map(screen => ({ id: screen.id, name: screen.name, sectionId: pages.find(node=>node.id===screen.flowNodeId)?.sectionId }));
  const sectionName = (sectionId:string|null|undefined) => project.flow.sections.find(section=>section.id===sectionId)?.title || '미지정 화면';
  const visibleChoices = choices.filter(choice=>`${choice.name} ${sectionName(choice.sectionId)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const choiceGroups = [...project.flow.sections.map(section=>({id:section.id,title:section.title,choices:visibleChoices.filter(choice=>choice.sectionId===section.id)})),{id:'unassigned',title:'미지정 화면',choices:visibleChoices.filter(choice=>!project.flow.sections.some(section=>section.id===choice.sectionId))}].filter(group=>group.choices.length);
  const ids = choices.filter(choice => selection[mode].includes(choice.id)).map(choice => choice.id);
  const group = project.flowGroups.find(item => item.versions.some(version => version.id === project.selectedFlowVersionId));
  const version = group?.versions.find(item => item.id === project.selectedFlowVersionId);
  const screenVersion = version?.wireframeVersions.find(item => item.id === project.selectedWireframeVersionId);
  const blocked = disabled || origin.current !== contextId || !ids.length;
  const toggle = (id: string) => setSelection(previous => ({ ...previous, [mode]: previous[mode].includes(id) ? previous[mode].filter(item => item !== id) : [...previous[mode],id] }));
  return <Modal title="와이어프레임 생성 대상 선택" onClose={onClose}><form onSubmit={event => {
    event.preventDefault();
    if (blocked) return;
    const extra = instruction.trim();
    onGenerate(prompts[mode] + (extra ? `\n\n추가 요청: ${extra}` : ''),ids,newVersion ? mode === 'missing' ? 'append' : 'regenerate' : 'edit');
  }}>
    <p className="wf-generation-context"><LayoutTemplate size={14}/><span>{group?.name || '현재 플로우'} / {version?.name || '현재 버전'}{version ? ` · v${version.number}` : ''}<br/>화면 버전: {screenVersion?.name || '현재 버전'}</span></p>
    <fieldset className="wf-generation-modes"><legend>작업 방식</legend>{(['missing','improve'] as const).map(value => <label key={value}><input type="radio" name="wireframe-generation-mode" aria-label={labels[value]} checked={mode === value} onChange={() => setMode(value)} disabled={disabled}/>{labels[value]}<span>{value === 'missing' ? missing.length : project.wireframes.length}</span></label>)}</fieldset>
    <div className="wf-generation-selection"><label><input type="checkbox" aria-label="대상 전체 선택" checked={choices.length > 0 && ids.length === choices.length} disabled={disabled || !choices.length} onChange={event => setSelection(previous => ({ ...previous, [mode]: event.target.checked ? choices.map(choice => choice.id) : [] }))}/>전체 선택</label><span role="status">{ids.length}개 선택 / {choices.length}개</span></div>
    <label className="wf-generation-search"><Search size={14}/><input aria-label="생성 대상 화면 검색" placeholder="화면 또는 섹션 검색" value={query} onChange={event=>setQuery(event.target.value)}/></label>
    <div className="wf-generation-list" role="group" aria-label="생성 대상 화면">{choices.length ? choiceGroups.length ? choiceGroups.map(group=><section className="wf-generation-group" key={group.id}><h4>{group.title}<span>{group.choices.length}</span></h4>{group.choices.map(choice => <label key={choice.id}><input type="checkbox" aria-label={`${choice.name} 선택`} data-testid={`wireframe-target-${choice.id}`} checked={ids.includes(choice.id)} disabled={disabled} onChange={() => toggle(choice.id)}/><span>{choice.name}</span><small>{mode === 'missing' ? '새 화면' : '기존 화면'}</small></label>)}</section>) : <p>검색 결과가 없습니다. 기존 선택은 유지됩니다.</p> : <p>{mode === 'missing' ? '모든 플로우 페이지에 화면이 있습니다. 기존 화면 개선을 선택해 주세요.' : '아직 개선할 화면이 없습니다. 미생성 페이지를 선택해 새 화면을 만들어 보세요.'}</p>}</div>
    {query.trim()&&<p className="field-help">검색 결과 {visibleChoices.length}개 · 검색에 표시되지 않은 화면의 선택도 유지됩니다. 전체 선택은 모든 대상에 적용됩니다.</p>}
    <label className="form-field">추가 요청 <span className="muted">선택 사항</span><textarea aria-label="화면 생성 추가 요청" rows={3} maxLength={12000} placeholder="예: 선택한 화면에 검색 필터와 빈 결과 상태를 포함해 주세요." value={instruction} disabled={disabled} onChange={event => setInstruction(event.target.value)}/></label>
    <label className="wf-generation-destination"><input type="checkbox" aria-label="새 화면 버전으로 만들기" checked={newVersion} disabled={disabled} onChange={event => setNewVersion(event.target.checked)}/>새 화면 버전으로 만들기</label>
    <p className="field-help">{newVersion ? '승인하면 원본을 보존한 새 화면 버전이 추가됩니다. 선택하지 않은 화면의 본문은 유지되며, 자동 동기화에 연결한 공통 영역은 기준 화면을 따릅니다.' : '승인하면 현재 화면 버전의 선택한 대상에 변경 사항을 반영합니다. 자동 동기화에 연결한 공통 영역도 기준 화면의 변경을 따릅니다.'}</p>
    {newVersion && <p className="field-help">페이지마다 Groq 요청 1회를 순서대로 실행합니다. 자동 재시도는 없으며 실패·취소된 화면만 직접 다시 요청할 수 있습니다. 재시도를 포함해 페이지당 최대 3회입니다. 일부만 성공했을 때는 성공한 화면만 별도로 승인할 수 있어요.</p>}
    <div className="modal-footer"><button className="secondary" type="button" onClick={onClose}>취소</button><button className="primary" type="submit" disabled={blocked}><Sparkles size={14}/>선택한 화면 생성 요청</button></div>
  </form></Modal>;
}
