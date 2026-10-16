import { useLayoutEffect, useRef } from 'react';
import { Controls } from '@xyflow/react';

/** Keep React Flow's native controls while naming their group accessibly. */
export function GraphControls({ label }: { label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // This installed Controls version accepts aria-label but neither role nor
    // arbitrary DOM props. Add only the missing semantic to its own container.
    host.current?.querySelector('[data-testid="rf__controls"]')?.setAttribute('role', 'group');
  }, []);
  return <div ref={host} style={{ display: 'contents' }}><Controls showInteractive={false} aria-label={label}/></div>;
}
