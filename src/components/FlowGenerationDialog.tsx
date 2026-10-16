import { useState } from 'react';
import { GitBranch, Sparkles } from 'lucide-react';
import type { FlowGenerationMode } from '../../shared/schema';
import { Modal } from './ui';
import './flow-context.css';

export const flowGenerationLabels: Record<FlowGenerationMode, string> = {
  edit: '현재 플로우 편집',
  'new-version': '현재 플로우의 AI 수정본',
  'new-group': '새 플로우 만들기',
};
export function FlowGenerationDialog({ hasNodes, versionName, onClose, onGenerate }: { hasNodes: boolean; versionName: string; onClose: () => void; onGenerate: (mode: FlowGenerationMode, prompt: string) => void }) {
  const [mode, setMode] = useState<FlowGenerationMode>(hasNodes ? 'new-version' : 'new-group');
  const [prompt, setPrompt] = useState(hasNodes ? '현재 플로우와 PRD, 기능명세를 바탕으로 사용자 여정을 개선해 줘. 누락된 단계와 예외 경로를 보완하고 관련 기능을 연결해 줘.' : 'PRD와 기능명세를 바탕으로 핵심 사용자의 시작, 페이지, 행동, 분기, 데이터 처리 흐름을 만들어 줘. 관련 기능을 연결하고 모든 연결선과 섹션을 포함해 줘.');
  return <Modal title="AI 플로우 생성" onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (prompt.trim()) onGenerate(mode,prompt.trim()); }}>
    <p className="help-copy">기준 버전: {versionName || '현재 플로우'}<br/>제안을 검토하고 승인하면 새 결과가 추가됩니다. 기존 플로우와 화면은 보존됩니다.</p>
    <fieldset className="flow-generation-options"><legend>생성 위치</legend>{(['new-version','new-group'] as const).map(value => <label key={value} className={mode === value ? 'selected' : ''}><input type="radio" aria-label={flowGenerationLabels[value]} name="flow-generation-mode" checked={mode === value} value={value} onChange={() => setMode(value)}/><span><strong>{flowGenerationLabels[value]}</strong><small>{value === 'new-version' ? '같은 그룹에 새로운 AI 수정본을 추가합니다.' : '별도 그룹에서 새로운 사용자 여정을 시작합니다.'}</small></span><GitBranch size={15}/></label>)}</fieldset>
    <label className="form-field">AI 요청 내용<textarea aria-label="플로우 AI 요청 내용" rows={4} value={prompt} onChange={event => setPrompt(event.target.value)} required/></label>
    <p className="field-help">새 결과의 와이어프레임은 비어 있습니다. 승인 후 새 플로우에 맞게 생성할 수 있어요.</p>
    <div className="modal-footer"><button className="secondary" type="button" onClick={onClose}>취소</button><button className="primary" type="submit" disabled={!prompt.trim()}><Sparkles size={14}/>AI 플로우 생성 요청</button></div>
  </form></Modal>;
}
