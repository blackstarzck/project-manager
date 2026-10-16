import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../shared/schema';
import { api } from './api';
import { readWorkspaceRoute, workspaceHash, type WorkspaceRoute } from './workspace-route';

type Guard = () => Promise<unknown>;
type BrowserEntry = { index: number | null };
const stateKey = 'planitWorkspace';
const entryIndex = (): number | null => {
  const value = history.state?.[stateKey]?.index;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
};
const entryState = (index: number) => ({ ...history.state, [stateKey]: { index } });
const routeUrl = (route: WorkspaceRoute) => `${location.pathname}${location.search}${workspaceHash(route)}`;

/** A pending route never replaces the editable workspace until its save guard succeeds. */
export function useWorkspaceNavigation() {
  const [project, setProject] = useState<Project | null>(null);
  const [route, setRoute] = useState<WorkspaceRoute>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const committed = useRef<{ route: WorkspaceRoute; project: Project | null; index: number }>({ route: null, project: null, index: 0 });
  const observedIndex = useRef(0);
  const guard = useRef<Guard | null>(null), sequence = useRef(0);
  const rollback = useRef<{ index: number; url: string } | null>(null);
  const registerGuard = useCallback((value: Guard) => {
    guard.current = value;
    return () => { if (guard.current === value) guard.current = null; };
  }, []);

  const navigate = useCallback(async (target: WorkspaceRoute, supplied?: Project, browserEntry?: BrowserEntry): Promise<boolean> => {
    const request = ++sequence.current;
    setPending(true); setError('');
    try {
      await guard.current?.();
      if (request !== sequence.current) return false;
      const next = target ? supplied?.id === target.projectId ? supplied : committed.current.project?.id === target.projectId ? committed.current.project : await api.project(target.projectId) : null;
      if (request !== sequence.current) return false;
      const sameRoute = workspaceHash(target) === workspaceHash(committed.current.route);
      const index = browserEntry ? browserEntry.index ?? observedIndex.current : observedIndex.current + (sameRoute ? 0 : 1);
      if (browserEntry || sameRoute) history.replaceState(entryState(index), '', routeUrl(target));
      else history.pushState(entryState(index), '', routeUrl(target));
      observedIndex.current = index;
      committed.current = { route: target, project: next, index };
      setProject(next); setRoute(target);
      return true;
    } catch (reason) {
      if (request !== sequence.current) return false;
      setError(reason instanceof Error ? reason.message : '화면을 열지 못했습니다. 다시 시도해 주세요.');
      const previous = committed.current;
      if (browserEntry?.index !== null && browserEntry?.index !== undefined && browserEntry.index !== previous.index) {
        // Return to the committed entry rather than overwriting an earlier entry on failed Back/Forward.
        rollback.current = { index: previous.index, url: routeUrl(previous.route) };
        history.go(previous.index - browserEntry.index);
      } else { history.replaceState(entryState(previous.index), '', routeUrl(previous.route)); observedIndex.current = previous.index; }
      return false;
    } finally {
      if (request === sequence.current) { setLoading(false); setPending(false); }
    }
  }, []);

  useEffect(() => {
    const index = entryIndex() ?? 0;
    committed.current.index = index; observedIndex.current = index;
    history.replaceState(entryState(index), '', location.href);
    const initial = readWorkspaceRoute(location.hash);
    void navigate(initial, undefined, { index });
    const onHashChange = () => {
      const index = entryIndex() ?? observedIndex.current + 1;
      observedIndex.current = index;
      // Stamp manually edited hashes immediately, including entries whose project request is superseded.
      history.replaceState(entryState(index), '', location.href);
      const restoring = rollback.current;
      if (restoring && index === restoring.index && `${location.pathname}${location.search}${location.hash}` === restoring.url) { rollback.current = null; return; }
      rollback.current = null;
      void navigate(readWorkspaceRoute(location.hash), undefined, { index });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => { sequence.current++; window.removeEventListener('hashchange', onHashChange); };
  }, [navigate]);

  return { project, route, loading, pending, error, clearError: () => setError(''), navigate, registerGuard };
}
