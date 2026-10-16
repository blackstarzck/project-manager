import { useState } from 'react';
import { Check, Circle, CircleAlert, LoaderCircle, Square } from 'lucide-react';
import type { AiRun, Proposal, WireScreen } from '../../shared/schema';
import './wireframe-page-tasks.css';

type PageTask = NonNullable<AiRun['pageTasks']>[number];
const labels: Record<PageTask['status'], string> = { queued:'대기',running:'생성 중',succeeded:'검증 완료',failed:'실패',cancelled:'취소' };

export function WireframePageTasks({ run, applied = false }: { run: AiRun; applied?: boolean }) {
  const tasks = run.pageTasks || [];
  if (!tasks.length) return null;
  const counts = run.pageSummary || { total:tasks.length,succeeded:tasks.filter(task => task.status === 'succeeded').length,failed:tasks.filter(task => task.status === 'failed').length,cancelled:tasks.filter(task => task.status === 'cancelled').length };
  const pending = tasks.filter(task => task.status === 'queued' || task.status === 'running').length;
  return <section className="wireframe-page-tasks" aria-label="화면별 생성 상태">
    <div className="page-task-counts" role="status"><strong>전체 {counts.total}개</strong><span>성공 {counts.succeeded}개</span><span>실패 {counts.failed}개</span>{counts.cancelled > 0 && <span>취소 {counts.cancelled}개</span>}{pending > 0 && <span>진행·대기 {pending}개</span>}</div>
    <ul>{tasks.map(task => <li key={task.id} data-testid={`page-task-${task.id}`} data-status={task.status}>
      <div className={`page-task-heading status-${task.status}`}>{task.status === 'running' ? <LoaderCircle size={12} className="spin"/> : task.status === 'succeeded' ? <Check size={12}/> : task.status === 'failed' ? <CircleAlert size={12}/> : task.status === 'cancelled' ? <Square size={10}/> : <Circle size={10}/>}<strong>{task.label}</strong><span>{labels[task.status]}</span></div>
      <div className="page-task-attempt">시도 {task.attempt} / 3{task.attempt >= 3 && ['failed','cancelled'].includes(task.status) ? ' · 재시도 한도에 도달했습니다.' : ''}</div>
      {task.error && <p className="page-task-error">{task.error}</p>}
      {task.status === 'succeeded' && task.screens?.length ? <ValidatedPageResult screens={task.screens}/> : null}
    </li>)}</ul>
    <p className="page-task-note">{applied ? '승인된 성공 결과는 결과 화면 버전에서 볼 수 있습니다.' : '검증이 완료된 결과도 승인 전에는 문서에 반영되지 않습니다.'}</p>
  </section>;
}

function ValidatedPageResult({ screens }: { screens: WireScreen[] }) {
  const [open, setOpen] = useState(false);
  return <details className="page-task-result" onToggle={event => setOpen(event.currentTarget.open)}><summary>검증된 화면 {screens.length}개 보기</summary>{open && <><ul>{screens.map(screen => <li key={screen.id}><strong>{screen.name}</strong><span>{screen.device}</span></li>)}</ul><pre>{JSON.stringify(screens,null,2)}</pre></>}</details>;
}

export function retryablePageTasks(run: AiRun) {
  return (run.pageTasks || []).filter(task => ['failed','cancelled'].includes(task.status) && task.attempt < 3);
}

export function pageRetryLabel(run: AiRun) {
  const tasks = retryablePageTasks(run), failed = tasks.some(task => task.status === 'failed'), cancelled = tasks.some(task => task.status === 'cancelled');
  return failed && cancelled ? '실패·취소한 화면만 다시 시도' : cancelled ? '취소한 화면만 다시 시도' : '실패한 화면만 다시 시도';
}

export function PartialProposalNote({ proposal }: { proposal: Proposal }) {
  if (!proposal.partial || !proposal.pageSummary) return null;
  const { total, succeeded, failed, cancelled } = proposal.pageSummary;
  return <div className="partial-proposal-note" role="note" aria-label="일부 화면 생성 결과">
    <strong>일부 화면만 생성되었습니다 · 성공 {succeeded} / 전체 {total}개</strong>
    <p>실패 {failed}개{cancelled ? ` · 취소 ${cancelled}개` : ''}. 성공한 화면을 승인하면 새 화면 버전으로 만듭니다. 실패·취소된 기존 화면의 내용과 선택하지 않은 화면의 본문은 보존됩니다. 자동 동기화에 연결한 공통 영역은 기준 화면을 따르며, 실패한 새 페이지는 추가하지 않습니다.</p>
    {!!proposal.navigationDetachedScreenIds?.length && <p>보존되는 화면 {proposal.navigationDetachedScreenIds.length}개의 공통 내비게이션 연결은 새 결과에서 해제됩니다. 해당 화면의 기존 내용은 유지됩니다.</p>}
  </div>;
}
