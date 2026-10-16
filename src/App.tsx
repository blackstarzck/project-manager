import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Check, CheckCheck, ChevronRight, CircleHelp, Download, FileText, GitBranch, History, Home, Layers, LayoutTemplate, LoaderCircle, PanelLeftOpen, Settings, Sparkles } from 'lucide-react';
import type { Artifact, FlowGenerationMode, WireframeGenerationMode, Project } from '../shared/schema';
import { api } from './api';
import { Dashboard } from './Dashboard';
import { useProject } from './useProject';
import { useWorkspaceNavigation } from './useWorkspaceNavigation';
import { AiPanel, type AiTrigger } from './components/AiPanel';
import { Brand, ErrorBanner, Loading, Tooltip } from './components/ui';
import { WorkspaceDialogs, type DialogKind } from './components/WorkspaceDialogs';
import { PrdEditor } from './editors/PrdEditor';
import { FeaturesEditor } from './editors/FeaturesEditor';
import { FlowEditor } from './editors/FlowEditor';
import { WireframeEditor } from './components/WireframeEditor';
import { FlowContextBar } from './components/FlowContextBar';
import { WireframeVersionPanel } from './components/WireframeVersionPanel';

export default function App() {
  const navigation = useWorkspaceNavigation();
  if (navigation.loading) return <Loading text="워크스페이스를 준비하고 있어요…"/>;
  return navigation.project && navigation.route ? <Workspace key={navigation.project.id} initial={navigation.project} artifact={navigation.route.artifact} navigationBusy={navigation.pending} navigationError={navigation.error} clearNavigationError={navigation.clearError} registerNavigationGuard={navigation.registerGuard} onArtifact={artifact => navigation.navigate({ projectId: navigation.project!.id, artifact })} onExit={() => navigation.navigate(null)}/> : <>{navigation.error && <ErrorBanner message={navigation.error} onClose={navigation.clearError}/>}<Dashboard onOpen={project => { void navigation.navigate({ projectId: project.id, artifact: 'prd' }, project); }}/></>;
}

function Workspace({ initial, artifact, navigationBusy, navigationError, clearNavigationError, registerNavigationGuard, onArtifact, onExit }: { initial: Project; artifact: Artifact; navigationBusy: boolean; navigationError: string; clearNavigationError: () => void; registerNavigationGuard: (guard: () => Promise<unknown>) => () => void; onArtifact: (artifact: Artifact) => Promise<boolean>; onExit: () => Promise<boolean> }) {
  const [error, setError] = useState(''), [aiVisible, setAiVisible] = useState(false);
  const [trigger, setTrigger] = useState<AiTrigger | null>(null), [dialog, setDialog] = useState<DialogKind>(null), [toast, setToast] = useState('');
  const { project, update, replace, reload, flush, mutate: mutateProject, transitioning, saveState, contextRecovery, recoverDraftContext, recoveryRequiresRestore } = useProject(initial, setError);
  const versionOperation = useRef<Promise<Project> | null>(null);
  const mutate = useCallback<typeof mutateProject>(operation => {
    const pending = mutateProject(operation);
    if (!versionOperation.current) versionOperation.current = pending;
    void pending.finally(() => { if (versionOperation.current === pending) versionOperation.current = null; }).catch(() => undefined);
    return pending;
  }, [mutateProject]);
  useLayoutEffect(() => registerNavigationGuard(async () => { await versionOperation.current; return flush(); }), [flush, registerNavigationGuard]);
  const notify = (message: string) => { setToast(message); };
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3500); return () => clearTimeout(id); }, [toast]);
  const generate = (prompt: string, entityIds?: string[], target = artifact, flowGenerationMode?: FlowGenerationMode, wireframeGenerationMode?: WireframeGenerationMode) => { setAiVisible(true); setTrigger({ id: crypto.randomUUID(), prompt, entityIds, artifact: target, flowVersionId: ['flow','wireframes'].includes(target) ? project.selectedFlowVersionId || undefined : undefined, flowGenerationMode: target === 'flow' ? flowGenerationMode : undefined, ...(target === 'wireframes' ? { wireframeVersionId:project.selectedWireframeVersionId || undefined, wireframeGenerationMode } : {}) }); };
  const preparePrdRequest = () => { setAiVisible(true); setTrigger({ id: crypto.randomUUID(), intent: 'draft', artifact: 'prd', prompt: '프로젝트 설명과 현재 PRD를 바탕으로 개요, 문제 및 해결 방안, 타겟 및 시나리오, 성공·위험 요소, 속성 설정의 PRD를 구체적으로 작성해 줘. 기존 사용자 작성 내용은 보존하며 필요한 내용을 보완해 줘.' }); };
  const switchTab = (target: Artifact) => onArtifact(target);
  const switchFlowVersion = async (versionId: string) => mutate(current => api.selectFlowVersion(current,versionId));
  const openFlowVersion = async (versionId: string) => { const value = await switchFlowVersion(versionId); await switchTab('flow'); return value; };
  const switchWireframeVersion = async (flowVersionId: string, wireframeVersionId: string) => mutate(current => api.selectWireframeVersion(current,flowVersionId,wireframeVersionId));
  const openWireframeVersion = async (flowVersionId: string, wireframeVersionId: string) => { const value = await switchWireframeVersion(flowVersionId,wireframeVersionId); await switchTab('wireframes'); return value; };
  const tabs = [{key:'prd',name:'PRD',Icon:FileText},{key:'features',name:'기능명세',Icon:Layers},{key:'flow',name:'유저플로우',Icon:GitBranch},{key:'wireframes',name:'와이어프레임',Icon:LayoutTemplate}] as const;
  return <div className="app-shell"><button className="skip-link" onClick={() => document.getElementById('workspace-document')?.focus()}>문서 편집 영역으로 이동</button><aside className="app-rail" aria-label="워크스페이스 도구"><Brand compact/><Tooltip label="프로젝트 목록"><button className="rail-button" aria-label="프로젝트 목록으로" onClick={() => { void onExit(); }}><Home size={19} aria-hidden="true"/></button></Tooltip><div className="rail-divider"/><Tooltip label="AI 도우미"><button className={`rail-button ${aiVisible ? 'active' : ''}`} aria-label="AI 도우미 열기" aria-expanded={aiVisible} onClick={() => setAiVisible(!aiVisible)}><Sparkles size={19} aria-hidden="true"/></button></Tooltip><div className="rail-bottom"><Tooltip label="사용 안내"><button className="rail-button" aria-label="사용 안내" disabled={navigationBusy} onClick={() => setDialog('help')}><CircleHelp size={19} aria-hidden="true"/></button></Tooltip><Tooltip label="프로젝트 설정"><button className="rail-button" aria-label="프로젝트 설정" disabled={navigationBusy} onClick={() => setDialog('settings')}><Settings size={18} aria-hidden="true"/></button></Tooltip></div></aside>
    <Tabs.Root asChild value={artifact} activationMode="manual" onValueChange={value => { void switchTab(value as Artifact); }}><div className="workspace"><header className="workspace-header"><div className="breadcrumbs"><button onClick={() => { void onExit(); }}>내 워크스페이스</button><ChevronRight size={14} aria-hidden="true"/><strong>{project.name}</strong><span className="badge">로컬</span></div><div className="header-actions"><span className={`save-state ${saveState === 'error' ? 'run-error' : ''}`} role="status">{saveState === 'saving' ? <LoaderCircle size={14} className="spin" aria-hidden="true"/> : saveState === 'saved' ? <CheckCheck size={14} aria-hidden="true"/> : null}{saveState === 'saved' ? '모든 변경 저장됨' : saveState === 'saving' ? '저장 중…' : saveState === 'pending' ? '저장 대기' : '저장 실패'}</span>{saveState === 'error' && <button className="secondary small" onClick={() => void flush().catch(() => undefined)}>저장 재시도</button>}<Tooltip label="버전 기록"><button className="icon-button" aria-label="버전 기록" disabled={navigationBusy} onClick={() => setDialog('versions')}><History size={16} aria-hidden="true"/></button></Tooltip><button className="secondary small" disabled={navigationBusy} onClick={() => setDialog('export')}><Download size={14} aria-hidden="true"/>내보내기</button><span className="user-avatar">ME</span></div></header>
      <nav className="document-navigation" aria-label="기획 문서 탐색">{!aiVisible && <Tooltip label="AI 패널 펼치기"><button className="icon-button" aria-label="AI 패널 펼치기" onClick={() => setAiVisible(true)}><PanelLeftOpen size={16} aria-hidden="true"/></button></Tooltip>}<Tabs.List className="document-tabs" aria-label="기획 문서">{tabs.map(({key,name,Icon}) => <Tabs.Trigger id={`document-tab-${key}`} aria-controls="workspace-document" value={key} className={`document-tab ${artifact === key ? 'active' : ''}`} key={key}><Icon size={16} aria-hidden="true"/>{name}</Tabs.Trigger>)}</Tabs.List></nav>
      {(error || navigationError) && <ErrorBanner message={error || navigationError} onClose={() => { setError(''); clearNavigationError(); }}/>}
      {saveState === 'error' && <div className="save-conflict-recovery">{contextRecovery && <button className="secondary small" disabled={transitioning} onClick={() => void recoverDraftContext(recoveryRequiresRestore).then(() => { setError(''); notify('편집하던 버전에 초안을 저장했어요.'); }).catch(() => undefined)}>{recoveryRequiresRestore ? '원래 버전 복원 후 돌아가 저장' : '편집하던 버전으로 돌아가 저장'}</button>}<span>이 화면의 편집 내용은 유지되고 있습니다. 저장 버전이 충돌했다면 초안을 보관한 뒤 최신 상태를 불러오세요.</span><button className="secondary small" onClick={() => { if (!confirm('현재 편집 내용을 백업 파일로 내려받은 뒤 서버의 최신 문서를 불러올까요? 백업 가져오기로 초안을 다시 열 수 있습니다.')) return; const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'planit-backup', version: 1, project }, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${project.name}-미저장-초안.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); void reload().then(() => { setError(''); notify('초안을 보관하고 최신 문서를 불러왔어요.'); }).catch(e => setError(e.message)); }}>초안 보관 후 최신 문서 불러오기</button></div>}
      <div className="workspace-body"><AiPanel project={project} artifact={artifact} visible={aiVisible} onClose={() => setAiVisible(false)} trigger={trigger} flush={flush} onProject={replace} onError={setError} onSwitchFlowVersion={switchFlowVersion} onOpenFlowVersion={openFlowVersion} onSwitchWireframeVersion={switchWireframeVersion} onOpenWireframeVersion={openWireframeVersion}/><main className="content-area" inert={transitioning || navigationBusy} aria-busy={transitioning || navigationBusy}><Tabs.Content asChild forceMount value={artifact} id="workspace-document" aria-labelledby={`document-tab-${artifact}`}><div className="document-panel" tabIndex={-1}>
        {artifact !== 'prd' && <h1 className="sr-only">{tabs.find(tab => tab.key === artifact)?.name}</h1>}
        {artifact === 'prd' && <PrdEditor project={project} onChange={value => update('prd',value)} onAi={preparePrdRequest}/>} 
        {artifact === 'features' && <FeaturesEditor project={project} onChange={value => update('features',value)} onAi={ids => generate(ids?.length ? '선택한 기능의 설명과 수용 기준을 구체화해 줘. 다른 기능은 변경하지 마.' : 'PRD를 바탕으로 요구사항, 기능, 상세 기능의 3단계 계층으로 기능명세를 작성해 줘. 각 항목에 설명과 수용 기준을 포함해 줘.',ids)}/>}
        {artifact === 'flow' && <FlowEditor key={project.selectedFlowVersionId || 'unversioned'} project={project} onChange={value => update('flow',value)} onAi={(mode,prompt) => generate(prompt,undefined,'flow',mode)} onError={setError} mutate={mutate} versionBusy={transitioning}/>}
        {artifact === 'wireframes' && <div className="wireframe-context-layout"><FlowContextBar project={project} busy={transitioning} onSwitch={switchFlowVersion} onError={setError}/><WireframeVersionPanel key={project.selectedFlowVersionId} project={project} busy={transitioning} mutate={mutate}/><WireframeEditor key={`${project.selectedFlowVersionId}:${project.selectedWireframeVersionId}`} project={project} onChange={value => update('wireframes',value)} onGenerate={(prompt,ids,mode) => generate(prompt,ids,'wireframes',undefined,mode)} disabled={transitioning}/></div>}
      </div></Tabs.Content></main></div></div></Tabs.Root>
    {dialog && <WorkspaceDialogs key={dialog} kind={dialog} onClose={() => setDialog(null)} project={project} artifact={artifact} flush={flush} onProject={replace} onError={setError} notify={notify}/>}
    {toast && <div className="toast" role="status"><Check size={15}/>{toast}</div>}
  </div>;
}
