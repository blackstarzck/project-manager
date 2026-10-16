import { useEffect, useRef, useState } from 'react';

/** View-only panel state. Resizing never writes document data or panel preferences. */
export function useEditorPanels({ leftWidth = 240, rightWidth = 280, minimum = 600, leftAvailable = true, rightAvailable = true }: { leftWidth?: number; rightWidth?: number; minimum?: number; leftAvailable?: boolean; rightAvailable?: boolean } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [leftWanted, setLeftWanted] = useState(true);
  const [rightWanted, setRightWanted] = useState(true);
  const [overlay, setOverlay] = useState<'left' | 'right' | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      // Keep an actively edited field reachable when a resize turns its panel into an overlay.
      const focused = document.activeElement;
      const activePanel = focused instanceof HTMLElement ? focused.closest('.editor-side-panel:not([hidden])') : null;
      if (activePanel && element.contains(activePanel)) setOverlay(activePanel.classList.contains('editor-side-left') ? 'left' : 'right');
      setWidth(element.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  const rightDocked = rightAvailable && rightWanted && width >= minimum + rightWidth;
  // Reserve the inspector first. Collapse the list before squeezing the canvas.
  const leftDocked = leftAvailable && leftWanted && width >= minimum + leftWidth + (rightAvailable && rightWanted ? rightWidth : 0);
  const leftVisible = leftAvailable && leftWanted && (leftDocked || overlay === 'left');
  const rightVisible = rightAvailable && rightWanted && (rightDocked || overlay === 'right');
  const close = (side: 'left' | 'right') => { (side === 'left' ? setLeftWanted : setRightWanted)(false); setOverlay(null); };
  const open = (side: 'left' | 'right') => { (side === 'left' ? setLeftWanted : setRightWanted)(true); setOverlay(side); };
  const toggle = (side: 'left' | 'right') => {
    if (side === 'left' ? leftVisible : rightVisible) { close(side); return; }
    open(side);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`.editor-side-${side} button:not(:disabled), .editor-side-${side} input:not(:disabled)`)?.focus());
  };
  return { ref, width, leftVisible, rightVisible, leftDocked, rightDocked, open, close, toggle,
    reservedWidth: (leftDocked ? leftWidth : 0) + (rightDocked ? rightWidth : 0),
    preferredReservedWidth: (leftAvailable && leftWanted ? leftWidth : 0) + (rightAvailable && rightWanted ? rightWidth : 0),
    panelClass: (side: 'left' | 'right') => `editor-side-panel editor-side-${side}${(side === 'left' ? leftDocked : rightDocked) ? '' : ' editor-side-overlay'}`,
  };
}
