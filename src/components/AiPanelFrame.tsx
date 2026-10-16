import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ExternalLink, GripHorizontal, PanelLeftClose, PanelLeftOpen, RotateCcw, Sparkles } from 'lucide-react';
import type { Artifact } from '../../shared/schema';
import './ai-panel-frame.css';

const STORAGE_KEY = 'planit.ai-panel.v1';
type Rect = { x: number; y: number; width: number; height: number };
export type AiPanelLayout = { version: 1; mode: 'docked' | 'floating'; open: boolean; dockWidth: number; floating: Rect };
type Viewport = { width: number; height: number };
type WorkspaceBounds = { width: number; left: number; top: number; height: number; reserved: number; minimum: number };
const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });
const bound = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
const defaults = (): AiPanelLayout => ({ version: 1, mode: 'docked', open: false, dockWidth: 360, floating: { x: 86, y: Math.max(8, window.innerHeight - 760), width: 412, height: 640 } });

/** Viewport containment is a rendering concern, never a rewrite of the user's saved preference. */
export function clampAiPanelLayout(layout: AiPanelLayout, view: Viewport): AiPanelLayout {
  const maxWidth = Math.max(1, Math.min(view.width - 16, Math.max(340, Math.min(720, view.width * .55))));
  const maxHeight = Math.max(1, Math.min(view.height - 16, Math.max(360, Math.min(860, view.height * .85))));
  const width = Math.round(bound(layout.floating.width, Math.min(340, maxWidth), maxWidth));
  const height = Math.round(bound(layout.floating.height, Math.min(360, maxHeight), maxHeight));
  return { ...layout, dockWidth: bound(layout.dockWidth, 320, 480), floating: { width, height, x: bound(layout.floating.x, 8, view.width - width - 8), y: bound(layout.floating.y, 8, view.height - height - 8) } };
}

export function aiPanelUsesOverlay(artifact: Artifact, workspaceWidth: number, dockWidth: number, reservedWidth: number, minimum = artifact === 'flow' || artifact === 'wireframes' ? 600 : 640): boolean {
  return workspaceWidth - bound(dockWidth, 320, 480) - Math.max(0, reservedWidth) < minimum;
}

export function readAiPanelLayout(): AiPanelLayout {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as AiPanelLayout | null;
    if (value?.version === 1 && ['docked','floating'].includes(value.mode) && typeof value.open === 'boolean' && [value.dockWidth, value.floating?.width, value.floating?.height, value.floating?.x, value.floating?.y].every(n => typeof n === 'number' && Number.isFinite(n))) {
      return { ...value, dockWidth: bound(value.dockWidth, 320, 480) };
    }
  } catch { /* Restricted storage must not prevent editing. */ }
  return defaults();
}

export function AiPanelFrame({ visible, artifact, onClose, children }: { visible: boolean; artifact: Artifact; onClose: () => void; children: ReactNode }) {
  const [preference, setPreference] = useState(readAiPanelLayout);
  const [view, setView] = useState(viewport), [announcement, setAnnouncement] = useState('');
  const [workspace, setWorkspace] = useState<WorkspaceBounds>(() => ({ width: window.innerWidth - 56, left: 56, top: 108, height: window.innerHeight - 108, reserved: 0, minimum: 640 }));
  const element = useRef<HTMLElement>(null), cleanupDrag = useRef<(() => void) | null>(null);
  const layout = clampAiPanelLayout(preference, view), floating = preference.mode === 'floating';
  const current = useRef(layout); current.current = layout;
  const overlay = !floating && aiPanelUsesOverlay(artifact, workspace.width, layout.dockWidth, workspace.reserved, workspace.minimum);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preference, open: visible })); } catch { /* Storage is optional. */ } }, [preference, visible]);
  useLayoutEffect(() => {
    const host = element.current?.closest<HTMLElement>('.workspace-body');
    if (!host) return;
    let frame = 0;
    const measure = () => {
      const box = host.getBoundingClientRect(), content = host.querySelector<HTMLElement>('.content-area');
      let actual = 0;
      content?.querySelectorAll<HTMLElement>('[data-editor-panel]').forEach(panel => {
        const style = getComputedStyle(panel);
        if (!['absolute','fixed'].includes(style.position)) actual += panel.getBoundingClientRect().width;
      });
      // Requested sidebars are reserved before docking to prevent an AI dock/undock
      // from repeatedly collapsing and reopening the editor's responsive panels.
      const wanted = Number(content?.querySelector<HTMLElement>('[data-preferred-reserved-width]')?.dataset.preferredReservedWidth || 0);
      const next = { width: box.width, left: box.left, top: box.top, height: box.height, reserved: Math.max(actual, wanted), minimum: Number(content?.querySelector<HTMLElement>('[data-min-canvas-width]')?.dataset.minCanvasWidth || (artifact === 'flow' || artifact === 'wireframes' ? 600 : 640)) };
      setWorkspace(previous => Object.keys(next).every(key => previous[key as keyof WorkspaceBounds] === next[key as keyof WorkspaceBounds]) ? previous : next);
      setView(previous => previous.width === window.innerWidth && previous.height === window.innerHeight ? previous : viewport());
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule); observer.observe(host);
    const changes = new MutationObserver(schedule); changes.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style','data-reserved-width','data-preferred-reserved-width','data-min-canvas-width'] });
    window.addEventListener('resize', measure); measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); changes.disconnect(); window.removeEventListener('resize', measure); };
  }, [artifact]);
  useEffect(() => () => cleanupDrag.current?.(), []);
  useEffect(() => { if (!visible) cleanupDrag.current?.(); }, [visible]);

  const adjust = (kind: 'move' | 'resize' | 'dock', x: number, y: number, base = current.current) => {
    if (kind === 'dock') setPreference(previous => ({ ...previous, dockWidth: bound(base.dockWidth + x, 320, 480) }));
    else {
      const proposed = { ...base, floating: kind === 'move' ? { ...base.floating, x: base.floating.x + x, y: base.floating.y + y } : { ...base.floating, width: base.floating.width + x, height: base.floating.height + y } };
      const next = clampAiPanelLayout(proposed, viewport());
      setPreference(previous => ({ ...previous, floating: next.floating }));
    }
  };
  const pointer = (event: PointerEvent<HTMLElement>, kind: 'move' | 'resize' | 'dock') => {
    if (event.button !== 0 || kind === 'move' && !floating) return;
    event.preventDefault(); cleanupDrag.current?.();
    const startX = event.clientX, startY = event.clientY, base = current.current;
    let frame = 0, lastX = startX, lastY = startY;
    const move = (next: globalThis.PointerEvent) => { lastX = next.clientX; lastY = next.clientY; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => adjust(kind, lastX-startX, lastY-startY, base)); };
    const stop = () => { cancelAnimationFrame(frame); adjust(kind,lastX-startX,lastY-startY,base); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); cleanupDrag.current = null; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); cleanupDrag.current = stop;
  };
  const reset = () => { setPreference(previous => ({ ...previous, dockWidth: 360, floating: defaults().floating })); setAnnouncement('AI 패널 위치와 크기를 초기화했습니다.'); };
  const keyboard = (event: KeyboardEvent, kind: 'move' | 'resize' | 'dock') => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { reset(); return; }
    const amount = event.shiftKey ? 40 : 10;
    adjust(kind, event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);
  };
  const toggleMode = () => { cleanupDrag.current?.(); setPreference(previous => ({ ...previous, mode: previous.mode === 'floating' ? 'docked' : 'floating' })); setAnnouncement(floating ? 'AI 패널을 왼쪽 패널로 되돌렸습니다.' : 'AI 패널을 분리했습니다. 제목 영역에서 방향키로 이동할 수 있습니다.'); };
  const mode = floating ? 'floating' : overlay ? 'overlay' : 'docked';
  const style = !visible ? { display: 'none' } : floating ? { left: `min(${layout.floating.x}px, max(8px, calc(100vw - ${layout.floating.width}px - 8px)))`, top: `min(${layout.floating.y}px, max(8px, calc(100dvh - ${layout.floating.height}px - 8px)))`, width: layout.floating.width, height: layout.floating.height } : overlay ? { left: workspace.left + 8, top: workspace.top + 8, width: Math.min(layout.dockWidth, view.width - workspace.left - 16), height: Math.max(1, workspace.height - 16) } : { width: layout.dockWidth };
  return <aside ref={element} className={`ai-panel ai-panel-frame ai-panel-${mode}`} style={style} aria-label="AI 기획 도우미" data-mode={preference.mode} data-presentation={mode}>
    <div className="ai-panel-header">
      <div className={`ai-panel-drag ${floating ? 'movable' : ''}`} role={floating ? 'button' : undefined} tabIndex={floating ? 0 : undefined} aria-label={floating ? 'AI 창 이동' : undefined} aria-describedby={floating ? 'ai-panel-move-help' : undefined} onPointerDown={event => pointer(event, 'move')} onKeyDown={event => { if (floating) keyboard(event, 'move'); }}><div className="ai-title"><span className="ai-icon"><Sparkles size={16}/></span>기획 도우미<span className="badge">AI</span></div>{floating && <GripHorizontal size={16} className="ai-panel-grip"/>}</div>
      <div className="ai-panel-window-actions"><button className="icon-button" title="패널 위치와 크기 초기화" aria-label="AI 패널 위치 초기화" onClick={reset}><RotateCcw size={15}/></button><button className="icon-button" title={floating ? '패널로 되돌리기' : '창으로 띄우기'} aria-label={floating ? '패널로 되돌리기' : '창으로 띄우기'} onClick={toggleMode}>{floating ? <PanelLeftOpen size={16}/> : <ExternalLink size={16}/>}</button><button className="icon-button" title="AI 패널 접기" aria-label="AI 패널 닫기" onClick={onClose}><PanelLeftClose size={17}/></button></div>
    </div>
    {overlay && <p className="ai-panel-overlay-note">문서 공간을 위해 겹쳐 표시하고 있어요.</p>}
    {children}
    {floating ? <button className="ai-panel-corner-resize" aria-label="AI 창 크기 조절" aria-describedby="ai-panel-resize-help" onPointerDown={event => pointer(event,'resize')} onKeyDown={event => keyboard(event,'resize')}><span/><span/></button> : <div className="ai-panel-dock-resize" role="separator" tabIndex={0} aria-label="AI 패널 너비 조절" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={480} aria-valuenow={Math.round(layout.dockWidth)} onPointerDown={event => pointer(event,'dock')} onKeyDown={event => keyboard(event,'dock')}/>}
    <span className="ai-panel-sr" id="ai-panel-move-help">방향키로 이동, Shift와 방향키로 크게 이동, Home으로 위치와 크기 초기화.</span><span className="ai-panel-sr" id="ai-panel-resize-help">좌우 방향키로 너비, 위아래 방향키로 높이 조절. Shift로 크게 조절.</span><span className="ai-panel-sr" role="status">{announcement}</span>
  </aside>;
}
