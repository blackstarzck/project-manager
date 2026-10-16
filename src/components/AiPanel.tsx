import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, LoaderCircle, RefreshCw, Sparkles, Square, X } from 'lucide-react';
import { artifactLabels, type AiRun, type AiStatus, type Artifact, type Change, type FlowGenerationMode, type WireframeGenerationMode, type Project, type ProjectActivity, type Proposal, type WireElement } from '../../shared/schema';
import { api, ApiError } from '../api';
import { Modal, plainText } from './ui';
import { AiPanelFrame } from './AiPanelFrame';
import { flowGenerationLabels } from './FlowGenerationDialog';
import { wireframeGenerationLabels } from './WireframeGenerationDialog';
import { WireframeStreamProgress } from './WireframeStreamProgress';
import { WireframePageTasks, PartialProposalNote, pageRetryLabel, retryablePageTasks } from './WireframePageTasks';
import './ai-review.css';

export interface AiTrigger { id: string; intent?: 'draft' | 'generate'; prompt: string; entityIds?: string[]; artifact: Artifact; flowVersionId?: string; flowGenerationMode?: FlowGenerationMode; wireframeVersionId?: string; wireframeGenerationMode?: WireframeGenerationMode }
type ResolutionFeedback = { proposalId: string; action: 'approve' | 'reject'; count: number; remaining: number };
const resolutionMessage = ({ action, count, remaining }: ResolutionFeedback) => `${count}개 변경을 ${action === 'approve' ? '승인해 문서에 반영했어요' : '거절했어요'}. ${remaining ? `남은 ${remaining}개는 검토 대기 중입니다.` : '모든 변경을 검토했어요.'}`;
const flowModeDescription: Record<FlowGenerationMode, string> = {
  edit: '승인하면 현재 플로우에 변경 사항을 반영합니다.',
  'new-version': '승인하면 같은 그룹에 AI 수정본을 추가합니다. 원본 플로우와 화면은 보존되며, 새 버전의 화면은 비어 있습니다.',
  'new-group': '승인하면 별도 그룹에 새 플로우를 추가합니다. 기존 플로우와 화면은 보존되며, 새 그룹의 화면은 비어 있습니다.',
};
function describeWireElement(element: WireElement, depth = 0): string {
  const indent = '  '.repeat(Math.min(depth, 12));
  const style = element.style ? Object.entries(element.style).map(([key,value]) => `${key}: ${value}`).join(', ') : '';
  const details = [style ? `(${style})` : '', element.action ? `동작: ${element.action}` : '', element.columns?.length ? `열: ${element.columns.join(' | ')}` : '', element.rows?.length ? element.rows.map(row => row.join(' | ')).join('\n') : ''].filter(Boolean);
  return `${indent}[${element.type}] ${element.text}${details.length ? `\n${indent}${details.join('\n'+indent)}` : ''}${depth < 12 && element.children?.length ? '\n'+element.children.map(child => describeWireElement(child,depth+1)).join('\n') : ''}`;
}
function describe(value: unknown): string {
  if (value == null) return '없음';
  if (Array.isArray(value) && value.every(item => item && typeof item === 'object' && 'elements' in item)) return value.length ? value.map(describe).join('\n\n────────\n\n') : '화면 없음';
  if (typeof value === 'string') return plainText(value);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('content' in object) return `${object.title || ''}\n\n${plainText(String(object.content || ''))}`;
    if ('description' in object && 'title' in object) return `${object.title}\n\n${object.description}\n\n${Array.isArray(object.acceptanceCriteria) ? object.acceptanceCriteria.map(c => `• ${c}`).join('\n') : ''}`;
    if ('elements' in object && Array.isArray(object.elements)) return `${object.name}\n\n${(object.elements as WireElement[]).map(element => describeWireElement(element)).join('\n')}`;
  }
  return JSON.stringify(value, null, 2);
}

export function AiPanel({ project, artifact, trigger, visible, onClose, flush, onProject, onError, onSwitchFlowVersion, onOpenFlowVersion, onSwitchWireframeVersion, onOpenWireframeVersion }: { project: Project; artifact: Artifact; trigger: AiTrigger | null; visible: boolean; onClose: () => void; flush: () => Promise<Project>; onProject: (project: Project) => void; onError: (error: string) => void; onSwitchFlowVersion: (versionId: string) => Promise<Project>; onOpenFlowVersion: (versionId: string) => Promise<Project>; onSwitchWireframeVersion: (flowVersionId: string, wireframeVersionId: string) => Promise<Project>; onOpenWireframeVersion: (flowVersionId: string, wireframeVersionId: string) => Promise<Project> }) {
  const [status, setStatus] = useState<AiStatus | null>(null), [model, setModel] = useState('');
  const [activity, setActivity] = useState<ProjectActivity>({ runs: [], proposals: [] }), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Proposal | null>(null), [selected, setSelected] = useState<string[]>([]), [resolving, setResolving] = useState(false);
  const [resolutionFeedback, setResolutionFeedback] = useState<ResolutionFeedback | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null), [localError, setLocalError] = useState('');
  const [flowGenerationMode, setFlowGenerationMode] = useState<FlowGenerationMode>('edit');
  const [wireframeGenerationMode, setWireframeGenerationMode] = useState<WireframeGenerationMode>('edit');
  const end = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null), seenTrigger = useRef<string | null>(null), mounted = useRef(true), activityRequest = useRef(0), resolutionLock = useRef(false);
  const refresh = async () => { const request = ++activityRequest.current; const result = await api.activity(project.id); if (mounted.current && request === activityRequest.current) setActivity(result); return result; };
  const receiveRun = (run: AiRun) => { activityRequest.current++; setActivity(previous => ({...previous,runs:[...previous.runs.filter(item => item.id !== run.id),run]})); };
  const refreshContextAfterError = async (error: unknown) => {
    if (!(error instanceof ApiError) || !['FLOW_CONTEXT_CONFLICT','WIREFRAME_CONTEXT_CONFLICT','VERSION_ARCHIVED'].includes(error.code || '')) return;
    const latest = await api.project(project.id).catch(() => undefined);
    if (latest && mounted.current) onProject(latest);
  };
  useEffect(() => { mounted.current = true; void refresh().catch(e => onError(e.message)); void api.status().then(s => { setStatus(s); setModel(s.model); }).catch(e => onError(e.message)); return () => { mounted.current = false; }; }, [project.id]);
  const running = activity.runs.some(r => ['queued','running'].includes(r.status));
  const versionLabel = (id?: string) => { if (!id) return ''; const group = project.flowGroups?.find(item => item.versions.some(version => version.id === id)); const version = group?.versions.find(item => item.id === id); return version ? `${group!.name} / ${version.name} (v${version.number})` : '이전 플로우 버전'; };
  const wireframeLabel = (flowId?: string, id?: string) => { const flow = project.flowGroups.flatMap(group => group.versions).find(version => version.id === flowId); const version = flow?.wireframeVersions.find(item => item.id === id); return `${versionLabel(flowId)} / ${version ? `${version.name} (화면 v${version.number})` : '이전 화면 버전'}`; };
  const reviewRun = review ? activity.runs.find(run => run.id === review.runId) : undefined;
  const reviewVersionId = review?.flowVersionId || reviewRun?.flowVersionId;
  const reviewMode = review?.flowGenerationMode || reviewRun?.flowGenerationMode || 'edit';
  const reviewWireframeId = review?.wireframeVersionId || reviewRun?.wireframeVersionId;
  const reviewWireframeMode = review?.wireframeGenerationMode || reviewRun?.wireframeGenerationMode || 'edit';
  const reviewProcessing = !!reviewRun && ['queued','running'].includes(reviewRun.status);
  const reviewMismatch = !!reviewVersionId && reviewVersionId !== project.selectedFlowVersionId || !!reviewWireframeId && reviewWireframeId !== project.selectedWireframeVersionId;
  const unresolvedChanges = review?.changes.filter(change => !review.resolvedChangeIds.includes(change.id)) || [];
  const reviewArtifact = reviewRun?.artifact || review?.changes[0]?.artifact || artifact;
  const changeCounts = unresolvedChanges.reduce((counts, change) => { counts[change.operation === 'delete' ? 'deleted' : change.before == null ? 'added' : 'updated']++; return counts; }, { added: 0, updated: 0, deleted: 0 });
  const reviewSwitchLabel = reviewWireframeId ? '원래 와이어프레임 버전으로 전환' : '원래 플로우 버전으로 전환';
  useEffect(() => { if (!running) return; const id = setInterval(() => { void refresh().catch(e => { setLocalError(`진행 상태를 확인하지 못했습니다: ${e.message}`); }); }, 900); return () => clearInterval(id); }, [running, project.id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, [activity.runs.length, running]);
  const start = async (prompt: string, target = artifact, entityIds?: string[], expectedFlowVersionId?: string, mode: FlowGenerationMode = 'edit', expectedWireframeVersionId?: string, wireframeMode: WireframeGenerationMode = 'edit') => {
    if (!prompt.trim() || busy || running) return;
    setBusy(true); setLocalError('');
    try {
      const latest = await flush();
      const scoped = ['flow','wireframes'].includes(target);
      const expected = expectedFlowVersionId || (scoped ? project.selectedFlowVersionId : undefined);
      if (scoped && expected && latest.selectedFlowVersionId !== expected) throw new Error('요청의 원래 플로우 버전으로 전환한 뒤 다시 생성해 주세요.');
      const expectedWireframe = expectedWireframeVersionId || (target === 'wireframes' ? project.selectedWireframeVersionId : undefined);
      if (target === 'wireframes' && expectedWireframe && latest.selectedWireframeVersionId !== expectedWireframe) throw new Error('요청의 원래 와이어프레임 버전으로 전환한 뒤 다시 생성해 주세요.');
      const run = await api.run(project.id, target, prompt.trim(), model || undefined, entityIds, scoped ? latest.selectedFlowVersionId || undefined : undefined, target === 'flow' ? mode : undefined, target === 'wireframes' ? latest.selectedWireframeVersionId || undefined : undefined, target === 'wireframes' ? wireframeMode : undefined);
      receiveRun(run);
      // An acknowledged request must not clear text typed while the server was responding.
      setDraft(current => current === prompt ? '' : current);
    }
    catch (e) { setLocalError((e as Error).message); onError((e as Error).message); await refreshContextAfterError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!trigger || trigger.id === seenTrigger.current) return;
    seenTrigger.current = trigger.id;
    if (trigger.intent === 'draft') {
      // Opening a writing assistant is never permission to spend a generation request.
      if (!busy && !running) setDraft(current => current.trim() ? current : trigger.prompt);
      composer.current?.focus({ preventScroll: true });
      return;
    }
    setDraft(trigger.prompt);
    if (trigger.artifact === 'flow') setFlowGenerationMode(trigger.flowGenerationMode || 'edit');
    if (trigger.artifact === 'wireframes') setWireframeGenerationMode(trigger.wireframeGenerationMode || 'edit');
    void start(trigger.prompt, trigger.artifact, trigger.entityIds, trigger.flowVersionId, trigger.flowGenerationMode, trigger.wireframeVersionId, trigger.wireframeGenerationMode);
  }, [trigger]);
  const openReview = (proposal: Proposal) => {
    setReview(proposal);
    // Server-persisted resolution history also keeps reopened/reloaded partial reviews unselected.
    setSelected(proposal.resolvedChangeIds.length ? [] : proposal.changes.map(change => change.id));
  };
  const switchContext = async (versionId: string, openResult = false, wireframeId?: string) => { setBusy(true); setLocalError(''); try { if (wireframeId) await (openResult ? onOpenWireframeVersion(versionId,wireframeId) : onSwitchWireframeVersion(versionId,wireframeId)); else await (openResult ? onOpenFlowVersion(versionId) : onSwitchFlowVersion(versionId)); } catch (error) { setLocalError((error as Error).message); await refreshContextAfterError(error); } finally { setBusy(false); } };
  const pageAction = async (run: AiRun, action: 'retry' | 'prepare') => {
    if (busy || running) return;
    const pageTaskIds = retryablePageTasks(run).map(task => task.id);
    if (action === 'retry' && !pageTaskIds.length) return;
    setBusy(true); setLocalError('');
    try {
      const latest = await flush();
      if (run.flowVersionId !== latest.selectedFlowVersionId || run.wireframeVersionId !== latest.selectedWireframeVersionId) throw new Error('요청의 원래 플로우와 와이어프레임 버전으로 전환한 뒤 다시 시도해 주세요.');
      const updated = action === 'retry' ? await api.retryPages(run.id,pageTaskIds) : await api.preparePageProposal(run.id);
      receiveRun(updated);
      if (review?.runId === run.id) setReview(null);
      const updatedActivity = await refresh();
      if (action === 'prepare') { const proposal = updatedActivity.proposals.find(item => item.id === updated.proposalId); if (proposal?.status === 'pending') openReview(proposal); }
    } catch (error) { setLocalError((error as Error).message); onError((error as Error).message); await refreshContextAfterError(error); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  };
  const resolve = async (action: 'approve' | 'reject') => {
    if (resolutionLock.current || !review || review.status !== 'pending' || !selected.length || reviewProcessing || busy) return; if (action === 'approve' && reviewMismatch) { setLocalError('제안을 생성한 문서 버전으로 전환한 뒤 승인해 주세요.'); return; } resolutionLock.current = true; setResolving(true); setLocalError('');
    try {
      await flush();
      const result = await api.resolve(review.id, action, selected, action === 'approve' && review.partial ? true : undefined);
      const remaining = result.proposal.changes.filter(change => !result.proposal.resolvedChangeIds.includes(change.id));
      const count = result.proposal.resolvedChangeIds.filter(id => !review.resolvedChangeIds.includes(id)).length;
      setSelected([]);
      setResolutionFeedback({ proposalId: review.id, action, count, remaining: remaining.length });
      setReview(remaining.length && result.proposal.status === 'pending' ? result.proposal : null);
      onProject(result.project);
      // An activity refresh failure must not turn a successful resolution back into a selected action.
      await refresh().catch(error => setLocalError(`변경 처리는 완료했지만 진행 상태를 새로 불러오지 못했어요: ${error.message}`));
    }
    catch (e) {
      setLocalError((e as Error).message); onError((e as Error).message);
      const refreshed = await refresh().catch(() => undefined);
      const updated = refreshed?.proposals.find(proposal => proposal.id === review.id);
      if (updated) { setReview(updated); if (updated.resolvedChangeIds.length > review.resolvedChangeIds.length) setSelected([]); }
      await refreshContextAfterError(e);
    }
    finally { resolutionLock.current = false; setResolving(false); }
  };
  const suggestions: Record<Artifact, string[]> = { prd: ['이 아이디어를 바탕으로 PRD를 작성해 줘', '사용자 문제와 해결 방안을 구체화해 줘', '빠진 성공 지표와 위험 요소를 검토해 줘'], features: ['PRD를 바탕으로 기능명세를 작성해 줘', '기능별 수용 기준을 구체화해 줘', 'MVP에 꼭 필요한 기능을 검토해 줘'], flow: ['핵심 사용자 여정의 플로우를 만들어 줘', '실패와 재시도 경로를 보완해 줘', '모바일 사용자의 흐름을 정리해 줘'], wireframes: ['유저 플로우의 페이지를 화면으로 만들어 줘', '사용자가 이해하기 쉽게 화면을 보완해 줘', '주요 동작 버튼과 화면 이동을 연결해 줘'] };
  const runs = [...activity.runs].sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  return <AiPanelFrame artifact={artifact} visible={visible} onClose={onClose}><div className="ai-content">
    {!runs.length && <div className="ai-intro"><div className="ai-intro-icon"><Sparkles size={23} strokeWidth={1.5}/></div><h3>함께 기획해 볼까요?</h3><p>만들고 싶은 제품을 알려 주세요.<br/>아이디어를 구체적인 문서와 화면으로<br/>차근차근 정리해 드릴게요.</p><div style={{ marginTop: 22 }}>{suggestions[artifact].map(s => <button className="prompt-suggestion" key={s} onClick={() => setDraft(s)}><span>{s}</span><ChevronRight size={13}/></button>)}</div></div>}
    {runs.map(run => { const proposal = activity.proposals.find(p => p.id === run.proposalId); const originId = run.flowVersionId || proposal?.flowVersionId; const originWireframeId = run.wireframeVersionId || proposal?.wireframeVersionId; const mismatch = !!originId && originId !== project.selectedFlowVersionId || !!originWireframeId && originWireframeId !== project.selectedWireframeVersionId; return <div key={run.id}><div className="chat-message user"><p>{run.prompt}</p></div><div className="chat-message assistant"><div className="chat-message-label"><Sparkles size={12}/>기획 도우미 <span className="chat-artifact-label">{artifactLabels[run.artifact]}</span></div><RunCard run={run} proposal={proposal} originLabel={originWireframeId ? wireframeLabel(originId,originWireframeId) : versionLabel(originId)} wireframeContext={!!originWireframeId} contextMismatch={mismatch} onSwitchContext={() => { if (originId) void switchContext(originId,false,originWireframeId); }} onReview={() => proposal && openReview(proposal)} onCancel={async () => { try { await api.cancel(run.id); await refresh(); } catch (e) { onError((e as Error).message); } }} onRetryPages={() => void pageAction(run,'retry')} onPreparePages={() => void pageAction(run,'prepare')} onRetry={() => void start(run.prompt, run.artifact, run.entityIds,originId,run.flowGenerationMode || proposal?.flowGenerationMode,originWireframeId,run.wireframeGenerationMode || proposal?.wireframeGenerationMode)} resultLabel={proposal?.resultWireframeVersionId ? wireframeLabel(originId,proposal.resultWireframeVersionId) : versionLabel(proposal?.resultFlowVersionId)} onOpenResult={() => { if (originId && proposal?.resultWireframeVersionId) void switchContext(originId,true,proposal.resultWireframeVersionId); else if (proposal?.resultFlowVersionId) void switchContext(proposal.resultFlowVersionId,true); }} expanded={expandedRun === run.id} toggle={() => setExpandedRun(expandedRun === run.id ? null : run.id)} busy={busy || running}/></div></div>; })}
    {localError && <p className="run-error" role="alert">{localError}</p>}
    {resolutionFeedback && !review && <p className="ai-resolution-feedback" role="status">{resolutionMessage(resolutionFeedback)}</p>}
    {status && !status.configured && <div className="run-card"><p>Groq API 키 설정이 필요해요. 로컬 환경 파일에 키를 설정한 뒤 서버를 다시 실행해 주세요.</p></div>}
    <div ref={end}/></div><form className="ai-composer" onSubmit={e => { e.preventDefault(); void start(draft,artifact,undefined,undefined,flowGenerationMode,undefined,wireframeGenerationMode); }}><div className="composer-box"><div className="composer-context"><span>@</span>{artifactLabels[artifact]} <span className="composer-context-detail">{['flow','wireframes'].includes(artifact) && project.selectedFlowVersionId ? artifact === 'wireframes' ? wireframeLabel(project.selectedFlowVersionId,project.selectedWireframeVersionId || undefined) : versionLabel(project.selectedFlowVersionId) : '프로젝트 맥락 포함'}</span></div>{artifact === 'flow' && <label className="composer-flow-mode">생성 방식<select aria-label="플로우 생성 방식" value={flowGenerationMode} onChange={event => setFlowGenerationMode(event.target.value as FlowGenerationMode)}>{Object.entries(flowGenerationLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}{artifact === 'wireframes' && <label className="composer-flow-mode">생성 방식<select aria-label="와이어프레임 생성 방식" value={wireframeGenerationMode} onChange={event => setWireframeGenerationMode(event.target.value as WireframeGenerationMode)}>{Object.entries(wireframeGenerationLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<textarea ref={composer} name="ai-request" autoComplete="off" aria-label="AI 요청" placeholder="어떤 기획을 도와드릴까요?" value={draft} onChange={e => setDraft(e.target.value)}/><div className="composer-tools"><select aria-label="AI 모델" value={model} onChange={e => setModel(e.target.value)}>{(status?.models || [model]).map(m => <option key={m} value={m}>{m.replace('openai/','')}</option>)}</select><button className="send-button" aria-label="AI 생성 요청" disabled={!draft.trim() || busy || running || status?.configured === false} type="submit">{busy ? <LoaderCircle size={14} className="spin" aria-hidden="true"/> : <ArrowUp size={16} aria-hidden="true"/>}<span>AI 생성 요청</span></button></div></div><p className="composer-footnote">요청을 확인한 뒤 AI 생성 요청을 눌러 주세요.<br/>{artifact === 'wireframes' && wireframeGenerationMode !== 'edit' && <>페이지별 Groq 요청 1회 · 자동 재시도 없음 · 페이지당 최대 3회<br/></>}{(artifact === 'flow' && flowGenerationMode !== 'edit' || artifact === 'wireframes' && wireframeGenerationMode !== 'edit') ? '승인하면 새 결과가 추가되고 기존 문서는 보존돼요.' : 'AI 제안은 승인 후 문서에 반영돼요.'}</p></form>
    {review && <Modal title="AI 변경 제안 검토" wide busy={resolving} description="AI가 제안한 변경을 비교하고 선택한 항목을 문서에 반영합니다." onClose={() => { if (!resolutionLock.current) setReview(null); }} footer={<div className="ai-review-actions">
      <div className="ai-review-feedback" role="status">
        {resolutionFeedback?.proposalId === review.id && <strong>{resolutionMessage(resolutionFeedback)}</strong>}
        {review.resolvedChangeIds.length > 0 && !selected.length && <span>남은 변경은 직접 선택한 뒤 승인하거나 거절해 주세요.</span>}
        <span id="review-selection-count" className="ai-review-selected">{resolving ? '선택한 변경을 처리하고 있어요…' : `${selected.length}개 변경 선택`}</span>
      </div>
      <div className="ai-review-action-buttons">{review.status !== 'pending' && review.status !== 'conflicted' ? <button className="secondary" onClick={() => setReview(null)}>검토 닫기</button> : reviewMismatch ? <button className="primary" disabled={busy || resolving} onClick={() => { if (reviewVersionId) void switchContext(reviewVersionId,false,reviewWireframeId); }}><ArrowRight size={14}/>{reviewSwitchLabel}</button> : review.status === 'conflicted' ? <button className="primary" disabled={resolving || busy || running || !reviewRun} onClick={() => { if (reviewRun) { setReview(null); void start(reviewRun.prompt, reviewRun.artifact, reviewRun.entityIds,reviewVersionId,reviewMode,reviewWireframeId,reviewWireframeMode); } }}><RefreshCw size={14}/>현재 문서로 다시 생성</button> : <>
        <button className="secondary" aria-label="선택 거절" aria-describedby="review-selection-count" disabled={resolving || busy || reviewProcessing || !selected.length} onClick={() => void resolve('reject')}><X size={14}/>선택 거절 <span className="ai-review-button-count">{selected.length}</span></button>
        <button className="primary" aria-label={review.partial ? '성공한 화면만 승인' : '선택 승인'} aria-describedby="review-selection-count" disabled={resolving || busy || reviewProcessing || !selected.length} onClick={() => void resolve('approve')}>{resolving ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>}{review.partial ? '성공한 화면만 승인' : '선택 승인'} <span className="ai-review-button-count">{selected.length}</span></button>
      </>}</div>
    </div>}><div className="ai-review-content">
      <div className="ai-review-target"><span>반영 대상</span><strong>{project.name} / {artifactLabels[reviewArtifact]}</strong><p>{reviewVersionId ? reviewWireframeId ? wireframeLabel(reviewVersionId,reviewWireframeId) : versionLabel(reviewVersionId) : `현재 문서 v${project.artifactRevisions[reviewArtifact]}`}</p></div>
      <div className="ai-review-counts" role="group" aria-label="남은 변경 유형"><span>추가 <strong>{changeCounts.added}</strong></span><span>수정 <strong>{changeCounts.updated}</strong></span><span>삭제 <strong>{changeCounts.deleted}</strong></span><span className="ai-review-pending">{review.resolvedChangeIds.length ? `검토 대기 ${unresolvedChanges.length}개 · ${review.resolvedChangeIds.length}개 처리 완료` : '승인 전 · 문서 미반영'}</span></div>
      <p className="proposal-summary">{review.summary}</p><PartialProposalNote proposal={review}/>
      {reviewRun?.artifact === 'flow' && <p className="flow-generation-target"><strong>{flowGenerationLabels[reviewMode]}</strong><br/>{flowModeDescription[reviewMode]}</p>}
      {reviewRun?.artifact === 'wireframes' && <p className="flow-generation-target"><strong>{wireframeGenerationLabels[reviewWireframeMode]}</strong><br/>{reviewWireframeMode === 'edit' ? '승인하면 현재 화면 버전에 변경 사항을 반영합니다.' : '전체 제안을 승인하면 기존 화면 버전을 보존한 새 버전이 추가됩니다. 선택하지 않은 화면의 본문은 유지되며, 자동 동기화에 연결한 공통 영역은 기준 화면을 따릅니다.'}</p>}
      {reviewVersionId && <p className="flow-context-label">생성 기준: {reviewWireframeId ? wireframeLabel(reviewVersionId,reviewWireframeId) : versionLabel(reviewVersionId)}</p>}
      <div className="proposal-selection"><label><input type="checkbox" disabled={resolving} checked={unresolvedChanges.length > 0 && selected.length === unresolvedChanges.length} onChange={e => setSelected(e.target.checked ? unresolvedChanges.map(change => change.id) : [])}/>전체 선택</label><span>{unresolvedChanges.length}개 변경 검토</span></div>
      {unresolvedChanges.map(change => <ChangePreview key={change.id} change={change} checked={selected.includes(change.id)} disabled={resolving} onCheck={() => setSelected(items => items.includes(change.id) ? items.filter(id => id !== change.id) : [...items,change.id])}/>)}
      {localError && <p className="run-error" role="alert">{localError}</p>}
      <p className="field-help">{review.status === 'cancelled' ? '재시도 또는 취소로 대체된 제안입니다. 최신 실행 결과에서 새 제안을 검토해 주세요.' : reviewMismatch ? '다른 문서 버전에서 만든 제안입니다. 원래 플로우와 화면 버전으로 전환하면 승인할 수 있어요.' : review.status === 'conflicted' ? '생성 이후 문서가 변경되어 이 제안은 반영하지 않았습니다. 같은 요청과 선택 범위로 현재 문서를 읽고 새 제안을 만들 수 있어요.' : '연결된 항목은 함께 선택해 주세요. 생성 이후 직접 수정한 항목은 충돌 검사 후 반영됩니다.'}</p>
    </div></Modal>}
  </AiPanelFrame>;
}
function ChangePreview({ change, checked, disabled, onCheck }: { change: Change; checked: boolean; disabled: boolean; onCheck: () => void }) {
  const operation = change.operation === 'delete' ? '삭제' : change.before == null ? '추가' : '수정';
  return <div className="proposal-change" data-operation={change.operation === 'delete' ? 'delete' : change.before == null ? 'add' : 'update'}><div className="proposal-change-header"><label><input type="checkbox" checked={checked} disabled={disabled} onChange={onCheck}/><strong>{change.summary}</strong></label><span className="badge">{operation}</span></div><div className="proposal-diff"><div className="proposal-before"><small>현재 내용</small><pre>{describe(change.before)}</pre></div><div className="proposal-after"><small>{change.operation === 'delete' ? '승인 후 삭제' : '변경 후'}</small><pre>{describe(change.after)}</pre></div></div></div>;
}
function RunCard({ run, proposal, onReview, onCancel, onRetry, onRetryPages, onPreparePages, expanded, toggle, busy, originLabel, contextMismatch, onSwitchContext, resultLabel, onOpenResult, wireframeContext }: { run: AiRun; proposal?: Proposal; onReview: () => void; onCancel: () => void; onRetry: () => void; onRetryPages: () => void; onPreparePages: () => void; expanded: boolean; toggle: () => void; busy: boolean; originLabel: string; contextMismatch: boolean; onSwitchContext: () => void; resultLabel: string; onOpenResult: () => void; wireframeContext: boolean }) {
  const processing = ['running','queued'].includes(run.status);
  const mode = run.flowGenerationMode || proposal?.flowGenerationMode || 'edit';
  const hasPageTasks = !!run.pageTasks?.length;
  const canRetryPages = hasPageTasks && !processing && !['applied','conflicted'].includes(proposal?.status || '') && retryablePageTasks(run).length > 0;
  const canPreparePages = hasPageTasks && !processing && ['cancelled','failed'].includes(run.status) && run.pageTasks!.some(task => task.status === 'succeeded') && (!proposal || proposal.status === 'cancelled');
  const canRetry = !hasPageTasks && ['failed','cancelled'].includes(run.status) || proposal?.status === 'conflicted';
  const needsOrigin = contextMismatch && (canRetry || canRetryPages || canPreparePages || proposal?.status === 'pending');
  return <div className="run-card" data-status={run.status} data-proposal-status={proposal?.status}><div className="run-card-header" role="status">{processing ? <LoaderCircle size={16} className="spin"/> : run.status === 'failed' || proposal?.status === 'conflicted' ? <AlertCircle size={16}/> : proposal?.status === 'applied' ? <Check size={16}/> : proposal?.status === 'rejected' ? <X size={16}/> : run.status === 'cancelled' ? <Square size={14}/> : <Sparkles size={16}/>}<span>{processing ? '기획을 정리하고 있어요' : run.status === 'cancelled' ? '생성이 취소됐어요' : run.status === 'failed' ? '생성을 완료하지 못했어요' : proposal?.status === 'applied' ? '변경 사항이 반영됐어요' : proposal?.status === 'rejected' ? '제안을 거절했어요' : proposal?.status === 'conflicted' ? '수정 충돌을 확인해 주세요' : '변경 제안을 준비했어요'}</span></div>
    <p>{run.error || proposal?.summary || (processing ? '프로젝트 맥락을 읽고 변경안을 만들고 있습니다. 문서는 아직 변경되지 않아요.' : run.status === 'cancelled' ? '기존 문서는 그대로 유지됩니다.' : '처리가 완료되었습니다.')}</p>
    {originLabel && <p className="flow-context-label">기준: {originLabel}</p>}
    {run.artifact === 'flow' && <p className="flow-generation-target">생성 방식: {flowGenerationLabels[mode]}</p>}
    {run.artifact === 'wireframes' && <p className="flow-generation-target">생성 방식: {wireframeGenerationLabels[run.wireframeGenerationMode || proposal?.wireframeGenerationMode || 'edit']}</p>}
    {hasPageTasks && <WireframePageTasks run={run} applied={proposal?.status === 'applied'}/>}
    {processing && run.artifact === 'wireframes' && !hasPageTasks && <WireframeStreamProgress output={run.output} targetCount={run.entityIds?.length || undefined}/>}
    {processing && <button className="ghost small" onClick={onCancel}><Square size={10}/>생성 취소</button>}
    {proposal?.status === 'pending' && <button className="primary small" onClick={onReview}>변경 제안 검토 <ArrowRight size={12}/></button>}
    {needsOrigin ? <button className="secondary small flow-context-switch" onClick={onSwitchContext} disabled={busy}><ArrowRight size={12}/>{wireframeContext ? '원래 와이어프레임 버전으로 전환' : '원래 플로우 버전으로 전환'}</button> : canRetry && <button className="secondary small" style={{ marginTop: 10 }} onClick={onRetry} disabled={busy}><RefreshCw size={12}/>{proposal?.status === 'conflicted' ? hasPageTasks ? '전체 요청으로 새로 생성' : '현재 문서로 다시 생성' : '다시 시도'}</button>}
    {!contextMismatch && (canRetryPages || canPreparePages) && <div className="page-task-actions">{canRetryPages && <button className="secondary small" disabled={busy} onClick={onRetryPages}><RefreshCw size={12}/>{pageRetryLabel(run)}</button>}{canPreparePages && <button className="secondary small" disabled={busy} onClick={onPreparePages}><ArrowRight size={12}/>보관된 성공 화면 검토</button>}</div>}
    {proposal?.partial && proposal.status === 'pending' && <p>일부 화면의 성공 결과입니다. 실패·취소된 화면은 검토에서 확인한 뒤 보존할 수 있어요.</p>}
    {hasPageTasks && proposal?.status === 'applied' && <p>승인한 실행은 다시 시도할 수 없습니다. 결과 버전에서 남은 화면을 선택해 새로 요청해 주세요.</p>}
    {(proposal?.resultFlowVersionId || proposal?.resultWireframeVersionId) && <><p className="flow-context-label">결과: {resultLabel}</p><button className="secondary small" disabled={busy} onClick={onOpenResult}><ArrowRight size={12}/>{proposal?.resultWireframeVersionId ? '생성된 와이어프레임 보기' : '생성된 플로우 보기'}</button></>}
    {run.output && <><button className="text-button small run-output-toggle" onClick={toggle}>{expanded ? '생성 내용 접기' : '생성 내용 보기'}<ChevronDown size={10}/></button>{expanded && <pre className="run-output">{run.output}</pre>}</>}
  </div>;
}
