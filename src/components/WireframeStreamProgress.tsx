import { useMemo } from 'react';
import { receivedWireframeScreens } from '../../shared/wireframe-stream';

export function WireframeStreamProgress({output,targetCount}:{output:string;targetCount?:number}){
  const screens=useMemo(()=>receivedWireframeScreens(output),[output]);
  return <div className="wireframe-stream-progress" data-testid="wireframe-stream-progress" aria-live="polite">
    <strong>화면 데이터 수신 {screens.length}개{targetCount ? ` · 요청 대상 ${targetCount}개` : ''}</strong>
    {screens.length>0&&<ul>{screens.map(screen=><li key={screen.id}>{screen.name}</li>)}</ul>}
    <span>전체 응답 검증 후 변경안을 검토할 수 있어요. 아직 문서에 반영되지 않았습니다.</span>
  </div>;
}
