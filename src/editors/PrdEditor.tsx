import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash2, Sparkles, FileText, CalendarDays, CheckCircle2, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { sectionLabels, type Project, type PrdItem } from '../../shared/schema';
import { RichEditor } from '../components/RichEditor';
import { dateLabel, uid } from '../components/ui';
import './prd-editor.css';

const defaults: Record<PrdItem['section'], string[]> = { overview: ['제품 한 줄 정의', '제품 목표와 배경'], problem: ['사용자 문제', '해결 방안과 차별점'], target: ['타겟 사용자', '핵심 사용자 시나리오'], success: ['성공 지표', '위험 요소'], attributes: ['제품 카테고리'] };
export function PrdEditor({ project, onChange, onAi }: { project: Project; onChange: (items: PrdItem[]) => void; onAi: () => void }) {
  const [outlinePreferred, setOutlinePreferred] = useState(true), [compact, setCompact] = useState(false), [overlayOpen, setOverlayOpen] = useState(false);
  const [focusItemId, setFocusItemId] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null), outline = useRef<HTMLElement>(null), outlineToggle = useRef<HTMLButtonElement>(null);
  const outlineVisible = compact ? overlayOpen : outlinePreferred;
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setCompact(element.clientWidth < 864);
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!compact) setOverlayOpen(false);
  }, [compact]);
  useEffect(() => {
    if (!compact || !overlayOpen) return;
    outline.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (outline.current?.contains(event.target as Node) || outlineToggle.current?.contains(event.target as Node)) return;
      setOverlayOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [compact, overlayOpen]);
  const closeOutline = () => { if (compact) setOverlayOpen(false); else setOutlinePreferred(false); outlineToggle.current?.focus(); };
  const jump = (id: string) => {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
    if (compact) setOverlayOpen(false);
  };
  const patch = (id: string, value: Partial<PrdItem>) => onChange(project.prd.map(item => item.id === id ? { ...item, ...value } : item));
  const add = (section: PrdItem['section'], title?: string) => {
    const id = uid();
    setFocusItemId(id);
    onChange([...project.prd, { id, revision: 0, section, title: title || '새 항목', content: '' }]);
  };
  const completed = project.prd.filter(item => item.content && item.content !== '<p></p>').length;
  return <>
    <div className="page-toolbar prd-toolbar"><span className="page-title"><FileText size={16}/>프로덕트 요구사항<span className="completion-label">{completed}개 항목 작성</span></span><div className="page-tools"><button ref={outlineToggle} className="secondary small" aria-label={outlineVisible ? '문서 구조 접기' : '문서 구조 열기'} aria-expanded={outlineVisible} aria-controls="prd-outline" onClick={() => compact ? setOverlayOpen(value => !value) : setOutlinePreferred(value => !value)}>{outlineVisible ? <PanelLeftClose size={16}/> : <PanelLeftOpen size={16}/>}문서 구조</button><button className="secondary small" onClick={onAi}><Sparkles size={15}/>AI 작성 도우미</button></div></div>
    <div ref={host} className={`prd-layout ${compact ? 'prd-layout-compact' : ''}`} data-preferred-reserved-width={outlinePreferred ? 224 : 0}>
      <div className="scroll-content" id="document-scroll"><div className="document-page prd-paper" data-export="prd"><div className="document-cover"><h1>{project.name}</h1><p>{project.description || '무엇을, 왜 만드는지 정리하는 기획의 시작점입니다.'}</p><div className="document-meta"><span><CalendarDays size={14}/>{dateLabel(project.updatedAt)} 업데이트</span><span><CheckCircle2 size={14}/>{completed}개 항목 작성</span><span>v{project.artifactRevisions.prd}</span></div></div>
        {(Object.entries(sectionLabels) as [PrdItem['section'], string][]).map(([section, label]) => {
          const items = project.prd.filter(item => item.section === section);
          return <section className="prd-section" id={`section-${section}`} tabIndex={-1} key={section}><div className="section-heading"><h2>{label}</h2></div>
            {items.length ? items.map(item => <div className="prd-item" id={`prd-item-${item.id}`} tabIndex={-1} key={item.id}><div className="prd-item-header"><input name={`prd-title-${item.id}`} autoComplete="off" aria-label={`${label} 항목 제목`} className="prd-item-title" value={item.title} maxLength={200} onChange={event => patch(item.id, { title: event.target.value || '새 항목' })}/><button className="icon-button" aria-label={`${item.title} 삭제`} onClick={() => { if (project.features.some(feature => feature.prdIds.includes(item.id))) { alert('기능명세가 이 PRD 항목을 참조하고 있습니다. 기능명세의 연결된 PRD 항목에서 연결을 해제한 뒤 삭제해 주세요.'); return; } if (confirm(`“${item.title}” 항목을 삭제할까요?`)) onChange(project.prd.filter(value => value.id !== item.id)); }}><Trash2 size={15}/></button></div><RichEditor value={item.content} focusRequested={focusItemId === item.id} onFocusHandled={() => setFocusItemId(current => current === item.id ? null : current)} label={`${item.title} 내용`} placeholder={`${item.title} 내용을 작성해 주세요…`} onChange={content => patch(item.id, { content })}/></div>) : <div className="prd-item"><div className="prd-item-header"><span className="prd-item-title">{defaults[section][0]}</span></div><button className="empty-item-input" onClick={() => add(section, defaults[section][0])}>{defaults[section][0]} 내용을 작성해 주세요…</button></div>}
            <button className="add-item-button" title={`${label} 항목 추가`} onClick={() => add(section, items.length === 0 ? defaults[section][0] : undefined)}><Plus size={16}/>항목 추가</button></section>;
        })}</div></div>
      <aside ref={outline} id="prd-outline" aria-label="PRD 문서 구조" className={`document-outline ${compact ? 'document-outline-overlay' : ''}`} style={{ display: outlineVisible ? 'block' : 'none' }} data-editor-panel="prd-outline" data-reserved-width={outlineVisible && !compact ? 224 : 0} onKeyDown={event => { if (compact && event.key === 'Escape') { event.preventDefault(); closeOutline(); } }}><div className="outline-heading"><h2 className="outline-title">문서 구조</h2><button className="icon-button" aria-label="문서 구조 닫기" onClick={closeOutline}><X size={16}/></button></div>{Object.entries(sectionLabels).map(([key,label]) => <div className="outline-section" key={key}><button className="outline-item" onClick={() => jump(`section-${key}`)}>{label}</button>{project.prd.filter(item => item.section === key).map(item => <button className="outline-subitem" key={item.id} onClick={() => jump(`prd-item-${item.id}`)}>{item.title}</button>)}</div>)}<div className="outline-footer">PRD는 기능명세와 화면 설계의 기준이 되는 문서예요.<br/><br/>AI 제안은 검토하고 승인하면 문서에 반영됩니다.</div></aside>
    </div>
  </>;
}
