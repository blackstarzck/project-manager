import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, History, RotateCcw } from 'lucide-react';
import type { Project, Revision } from '../../shared/schema';
import { api } from '../api';
import { Loading, Modal } from './ui';
import './version-history.css';

type Preview = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; project: Project };

// A template stays inert and is never inserted into the document. Only its text
// is rendered by React: saved markup cannot execute or load external resources.
function previewText(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script,style,noscript,iframe,object,embed,template').forEach(node => node.remove());
  template.content.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  template.content.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,blockquote').forEach(node => node.append('\n'));
  return (template.content.textContent || '').replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function counts(project: Project) {
  return `PRD ${project.prd.length}개 · 기능명세 ${project.features.length}개 · 플로우 ${project.flow.nodes.length}개 노드 · 화면 ${project.wireframes.length}개`;
}

const SnapshotPreview = memo(function SnapshotPreview({ project }: { project: Project }) {
  return <div className="version-preview-content">
    <p className="version-preview-counts">{counts(project)}</p>
    <p className="version-preview-context">프로젝트: {project.name}</p>
    <section aria-label="PRD 미리보기"><h4>PRD</h4>{project.prd.length ? project.prd.map(item => <article className="version-preview-prd" key={item.id}><h5>{item.title}</h5><p>{previewText(item.content) || '작성된 본문이 없어요.'}</p></article>) : <p className="version-preview-empty">작성된 PRD가 없어요.</p>}</section>
    <section aria-label="기능명세 미리보기"><h4>기능명세</h4>{project.features.length ? <ul>{project.features.map(item => <li key={item.id}>{item.title}</li>)}</ul> : <p className="version-preview-empty">작성된 기능명세가 없어요.</p>}</section>
    <section aria-label="플로우 미리보기"><h4>유저 플로우</h4>{project.flow.nodes.length ? <><p className="version-preview-context">노드 {project.flow.nodes.length}개 · 연결 {project.flow.edges.length}개</p><ul>{project.flow.nodes.map(node => <li key={node.id}>{node.label}</li>)}</ul></> : <p className="version-preview-empty">작성된 플로우가 없어요.</p>}</section>
    <section aria-label="와이어프레임 미리보기"><h4>와이어프레임</h4>{project.wireframes.length ? <ul>{project.wireframes.map(screen => <li key={screen.id}>{screen.name}</li>)}</ul> : <p className="version-preview-empty">작성된 화면이 없어요.</p>}</section>
  </div>;
});

export function VersionHistory({ project, flush, onProject, onClose, notify, onError }: {
  project: Project; flush: () => Promise<Project>; onProject: (value: Project) => void;
  onClose: () => void; notify: (message: string) => void; onError: (message: string) => void;
}) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [savedRevision, setSavedRevision] = useState(project.revision);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const callbacks = useRef({ flush, onProject, onClose, notify, onError });
  callbacks.current = { flush, onProject, onClose, notify, onError };
  const generation = useRef(0);
  const restorePending = useRef(false);
  const previewPending = useRef(new Set<string>());
  const currentRevision = Math.max(project.revision, savedRevision);

  const loadHistory = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setError('');
    try {
      const saved = await callbacks.current.flush();
      if (generation.current !== token || saved.id !== project.id) return;
      setSavedRevision(saved.revision);
      const entries = await api.revisions(project.id);
      if (generation.current === token) setRevisions(entries);
    } catch (cause) {
      if (generation.current === token) setError((cause as Error).message);
    } finally {
      if (generation.current === token) setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    setRevisions(null); setExpanded(null); setPreviews({});
    setSavedRevision(project.revision); previewPending.current.clear();
    void loadHistory();
    return () => { generation.current++; };
  }, [loadHistory]);

  const loadPreview = async (revision: Revision) => {
    if (previewPending.current.has(revision.id)) return;
    const token = generation.current;
    previewPending.current.add(revision.id);
    setPreviews(values => ({ ...values, [revision.id]: { status: 'loading' } }));
    try {
      const snapshot = await api.revisionSnapshot(project.id, revision.id);
      if (generation.current !== token) return;
      if (snapshot.id !== project.id || snapshot.revision !== revision.revision) throw new Error('선택한 버전과 다른 내용이 도착했습니다. 다시 불러와 주세요.');
      setPreviews(values => ({ ...values, [revision.id]: { status: 'ready', project: snapshot } }));
    } catch (cause) {
      if (generation.current === token) setPreviews(values => ({ ...values, [revision.id]: { status: 'error', message: (cause as Error).message } }));
    } finally {
      if (generation.current === token) previewPending.current.delete(revision.id);
    }
  };

  const restore = async (revision: Revision) => {
    if (restorePending.current || revision.revision === currentRevision) return;
    if (!confirm(`버전 ${revision.revision}의 전체 문서와 프로젝트 설정을 복원할까요? 현재 버전은 기록에 보존됩니다.`)) return;
    restorePending.current = true;
    const token = generation.current;
    setBusy(true); setError('');
    try {
      const saved = await callbacks.current.flush();
      if (generation.current !== token || saved.id !== project.id) return;
      const restored = await api.restoreRevision(saved, revision.id);
      if (generation.current !== token) return;
      callbacks.current.onProject(restored);
      callbacks.current.notify(`버전 ${revision.revision}의 내용을 새 버전으로 복원했어요.`);
      callbacks.current.onClose();
    } catch (cause) {
      if (generation.current === token) {
        const message = (cause as Error).message;
        setError(message); callbacks.current.onError(message);
      }
    } finally {
      restorePending.current = false;
      if (generation.current === token) setBusy(false);
    }
  };

  return <Modal title="프로젝트 버전 기록" wide busy={busy} onClose={onClose} footer={<button type="button" className="secondary" disabled={busy} onClick={onClose}>기록 닫기</button>}>
    <div className="version-history">
      <p className="help-copy">내용 미리보기에서 복원할 버전을 확인하세요. 미리보기는 현재 문서를 변경하지 않습니다.</p>
      <p className="version-history-warning">복원하면 PRD·기능명세·플로우·와이어프레임과 프로젝트 설정이 함께 복원됩니다. 현재 기록은 보존됩니다.</p>
      {error && <div className="version-history-error"><p className="run-error" role="alert">{error}</p>{!revisions && <button type="button" className="secondary" disabled={loading} onClick={() => void loadHistory()}>기록 다시 불러오기</button>}</div>}
      {loading ? <Loading text="버전 기록 불러오는 중…"/> : revisions && <div className="version-history-list">{revisions.map(revision => {
        const preview = previews[revision.id];
        const isExpanded = expanded === revision.id;
        const current = revision.revision === currentRevision;
        const previewId = `version-preview-${revision.id}`;
        return <article className="version-history-entry" key={revision.id} aria-label={`버전 ${revision.revision}${current ? ' 현재 버전' : ''}`}>
          <div className="version-history-heading"><History size={18} aria-hidden="true"/><div><h3>{revision.label || `버전 ${revision.revision}`}{current && <span className="version-current">현재 버전</span>}</h3><p>v{revision.revision} · <time dateTime={revision.createdAt}>{new Date(revision.createdAt).toLocaleString('ko-KR')}</time></p>{preview?.status === 'ready' && <p className="version-history-summary">{counts(preview.project)}</p>}</div></div>
          <div className="version-history-actions"><button type="button" className="secondary" disabled={busy} aria-label={`버전 ${revision.revision} 내용 미리보기`} aria-expanded={isExpanded} aria-controls={previewId} onClick={() => {
            setExpanded(isExpanded ? null : revision.id);
            if (!isExpanded && !preview) void loadPreview(revision);
          }}>{isExpanded ? <ChevronUp size={16} aria-hidden="true"/> : <ChevronDown size={16} aria-hidden="true"/>}{isExpanded ? '미리보기 접기' : '내용 미리보기'}</button><button type="button" className="secondary" disabled={busy || current} aria-label={`버전 ${revision.revision} 복원`} onClick={() => void restore(revision)}><RotateCcw size={14} aria-hidden="true"/>복원</button></div>
          <div id={previewId} className="version-preview" role="region" aria-label={`버전 ${revision.revision} 내용`} hidden={!isExpanded}>{isExpanded && (preview?.status === 'ready' ? <SnapshotPreview project={preview.project}/> : preview?.status === 'error' ? <><p className="run-error" role="alert">{preview.message}</p><button type="button" className="secondary" onClick={() => void loadPreview(revision)} disabled={busy}>미리보기 다시 불러오기</button></> : <Loading text="버전 내용 불러오는 중…"/>)}</div>
        </article>;
      })}{!revisions.length && <p className="help-copy">아직 저장된 변경 기록이 없어요.</p>}</div>}
    </div>
  </Modal>;
}
