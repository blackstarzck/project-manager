import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artifact, Project } from '../shared/schema';
import { api } from './api';

type DraftScope = { expectedRevision: number; flowVersionId?: string | null; wireframeVersionId?: string | null };
const scopeOf = (project: Project, artifact: Artifact): DraftScope => ({ expectedRevision:project.artifactRevisions[artifact], ...(['flow','wireframes'].includes(artifact) ? {flowVersionId:project.selectedFlowVersionId} : {}), ...(artifact === 'wireframes' ? {wireframeVersionId:project.selectedWireframeVersionId} : {}) });
const sameContext = (project: Project, scope: DraftScope) => (scope.flowVersionId === undefined || scope.flowVersionId === project.selectedFlowVersionId) && (scope.wireframeVersionId === undefined || scope.wireframeVersionId === project.selectedWireframeVersionId);

export function useProject(initial: Project, onError: (message: string) => void) {
  const [project, setProject] = useState(initial);
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [transitioning, setTransitioning] = useState(false);
  const [contextRecovery, setContextRecovery] = useState(false);
  const [recoveryRequiresRestore, setRecoveryRequiresRestore] = useState(false);
  const mutation = useRef(false);
  const current = useRef(initial), server = useRef(initial), dirty = useRef(new Map<Artifact, Project[Artifact]>());
  const draftScopes = useRef(new Map<Artifact, DraftScope>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<Project> | null>(null);
  const errorHandler = useRef(onError); errorHandler.current = onError;
  const publish = (value: Project) => { current.current = value; setProject(value); };
  const acceptServer = (value: Project) => {
    // Independent requests can commit in order and arrive in the opposite order.
    if (value.id === server.current.id && value.revision >= server.current.revision) server.current = value;
    return server.current;
  };
  const publishPending = (value: Project) => {
    if ([...draftScopes.current.values()].some(scope => !sameContext(value,scope))) {
      // Keep the draft visibly attached to its origin; never overlay it on a fork.
      setContextRecovery(true); setSaveState('error');
      errorHandler.current('다른 창에서 문서 버전이 변경되었습니다. 초안은 편집하던 버전에 보존되어 있습니다. 원래 버전으로 돌아가 저장해 주세요.');
      return;
    }
    const merged = { ...value };
    for (const [key,pending] of dirty.current) Object.assign(merged,{[key]:pending});
    setContextRecovery(false); setRecoveryRequiresRestore(false); publish(merged);
  };
  const flush = useCallback(async (): Promise<Project> => {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) { await running.current; if (!dirty.current.size) return current.current; }
    const work = async () => {
      try {
        while (dirty.current.size) {
          setSaveState('saving');
          const [artifact, value] = [...dirty.current.entries()][0];
          const scope = draftScopes.current.get(artifact) || scopeOf(current.current,artifact);
          const basis = { ...server.current, artifactRevisions:{...server.current.artifactRevisions,[artifact]:scope.expectedRevision}, ...(scope.flowVersionId !== undefined ? {selectedFlowVersionId:scope.flowVersionId} : {}), ...(scope.wireframeVersionId !== undefined ? {selectedWireframeVersionId:scope.wireframeVersionId} : {}) };
          const saved = await api.save(basis, artifact, value);
          const accepted = acceptServer(saved);
          if (dirty.current.get(artifact) === value) { dirty.current.delete(artifact); draftScopes.current.delete(artifact); }
          else if (sameContext(saved,scope)) draftScopes.current.set(artifact,{...scope,expectedRevision:saved.artifactRevisions[artifact]});
          publishPending(accepted);
        }
        setSaveState('saved'); return current.current;
      } catch (error) { setSaveState('error'); if (error instanceof Error && 'code' in error && ['FLOW_CONTEXT_CONFLICT','WIREFRAME_CONTEXT_CONFLICT','VERSION_ARCHIVED'].includes(String(error.code))) { setContextRecovery(true); if (error.code === 'VERSION_ARCHIVED') setRecoveryRequiresRestore(true); } errorHandler.current(error instanceof Error ? error.message : '저장하지 못했습니다.'); throw error; }
    };
    running.current = work();
    try { return await running.current; } finally { running.current = null; }
  }, []);
  const update = useCallback(<A extends Artifact>(artifact: A, value: Project[A]) => {
    if (mutation.current) return;
    if (!draftScopes.current.has(artifact)) draftScopes.current.set(artifact,scopeOf(current.current,artifact));
    dirty.current.set(artifact, value); publish({ ...current.current, [artifact]: value }); setSaveState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 700);
  }, [flush]);
  const replace = useCallback((value: Project) => { const accepted = acceptServer(value); publishPending(accepted); if (!dirty.current.size) setSaveState('saved'); }, []);
  const reload = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) await running.current.catch(() => undefined);
    const value = await api.project(current.current.id);
    const accepted = acceptServer(value);
    dirty.current.clear(); draftScopes.current.clear(); setContextRecovery(false); setRecoveryRequiresRestore(false); publish(accepted); setSaveState('saved');
  }, []);
  const mutate = useCallback(async (operation: (project: Project) => Promise<Project>) => {
    if (mutation.current) throw new Error('문서 전환을 마친 뒤 다시 시도해 주세요.');
    mutation.current = true; setTransitioning(true);
    try {
      await flush();
      const value = await operation(current.current);
      const accepted = acceptServer(value);
      publishPending(accepted); setSaveState('saved');
      return accepted;
    } catch (error) { errorHandler.current(error instanceof Error ? error.message : '문서를 전환하지 못했습니다.'); throw error; }
    finally { mutation.current = false; setTransitioning(false); }
  }, [flush]);
  const recoverDraftContext = useCallback(async (restoreArchived = false) => {
    if (mutation.current) throw new Error('문서 전환을 마친 뒤 다시 시도해 주세요.');
    mutation.current = true; setTransitioning(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      if (running.current) await running.current.catch(() => undefined);
      const scope = draftScopes.current.get('wireframes') || draftScopes.current.get('flow');
      if (!scope?.flowVersionId) return await flush();
      let latest = await api.project(current.current.id); acceptServer(latest);
      const group = latest.flowGroups.find(item => item.versions.some(version => version.id === scope.flowVersionId));
      const flow = group?.versions.find(version => version.id === scope.flowVersionId);
      const wireframe = flow?.wireframeVersions.find(version => version.id === scope.wireframeVersionId);
      if (group?.archivedAt || flow?.archivedAt || wireframe?.archivedAt) {
        setContextRecovery(true); setRecoveryRequiresRestore(true);
        if (!restoreArchived) throw new Error('편집하던 버전이 휴지통에 있습니다. 초안을 보존했습니다. 원래 버전 복원 후 돌아가 저장 버튼으로 복원해 주세요.');
        if (group?.archivedAt) latest = await api.archiveFlowGroup(latest,group.id,false);
        if (flow?.archivedAt) latest = await api.archiveFlowVersion(latest,flow.id,false);
        if (wireframe?.archivedAt) latest = await api.archiveWireframeVersion(latest,flow!.id,wireframe.id,false);
      }
      const restored = scope.wireframeVersionId ? await api.selectWireframeVersion(latest,scope.flowVersionId,scope.wireframeVersionId) : await api.selectFlowVersion(latest,scope.flowVersionId);
      publishPending(acceptServer(restored));
      return await flush();
    } catch (error) { setSaveState('error'); errorHandler.current(error instanceof Error ? error.message : '원래 편집 버전으로 돌아가지 못했습니다.'); throw error; }
    finally { mutation.current = false; setTransitioning(false); }
  }, [flush]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current.size || running.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('beforeunload', beforeUnload); if (timer.current) clearTimeout(timer.current); };
  }, []);
  return { project, update, replace, reload, flush, mutate, transitioning, saveState, contextRecovery, recoverDraftContext, recoveryRequiresRestore };
}
