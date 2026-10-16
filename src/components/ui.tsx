import { forwardRef, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Tip from '@radix-ui/react-tooltip';
import { X, LoaderCircle, AlertCircle, ArrowUpRight } from 'lucide-react';

export function Modal({ title, children, onClose, wide = false, footer, busy = false, description }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; footer?: ReactNode; busy?: boolean; description?: string }) {
  const element = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="modal-backdrop">
      <Dialog.Content className={`modal ${wide ? 'modal-wide' : ''}`} ref={element} tabIndex={-1} aria-busy={busy}
        onOpenAutoFocus={event => { event.preventDefault(); element.current?.focus(); }}
        onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
        onInteractOutside={event => { if (busy) event.preventDefault(); }}>
        <div className="modal-header"><Dialog.Title asChild><h2>{title}</h2></Dialog.Title><Dialog.Close asChild><button type="button" className="icon-button" disabled={busy} aria-label="닫기"><X size={19}/></button></Dialog.Close></div>
        <Dialog.Description className="sr-only">{description || title}</Dialog.Description>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </Dialog.Content>
    </Dialog.Overlay></Dialog.Portal>
  </Dialog.Root>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary'|'secondary'|'ghost'|'danger'; loading?: boolean }>(function Button({ variant='primary', loading=false, disabled, className='', children, type='button', ...props }, ref) {
  return <button {...props} ref={ref} type={type} className={`${variant} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined}>{loading && <LoaderCircle size={16} className="spin" aria-hidden="true"/>}{children}</button>;
});

export function TextField({ label, help, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label:string; help?:string; error?:string }) {
  const generated=useId(), fieldId=id || generated, helpId=`${fieldId}-help`;
  return <div className="form-field"><label htmlFor={fieldId}>{label}</label><input {...props} id={fieldId} aria-invalid={!!error || undefined} aria-describedby={error || help ? helpId : undefined}/>{(error || help) && <span id={helpId} className={error ? 'field-error' : 'field-help'} role={error ? 'alert' : undefined}>{error || help}</span>}</div>;
}

export function Tooltip({ label, children }: { label:string; children:ReactElement }) {
  return <Tip.Provider delayDuration={450}><Tip.Root><Tip.Trigger asChild>{children}</Tip.Trigger><Tip.Portal><Tip.Content className="ui-tooltip" sideOffset={6}>{label}<Tip.Arrow/></Tip.Content></Tip.Portal></Tip.Root></Tip.Provider>;
}

export function ActionMenu({ trigger, items }: { trigger:ReactElement; items:{id:string;label:string;icon?:ReactNode;disabled?:boolean;danger?:boolean;onSelect:()=>void}[] }) {
  return <Dropdown.Root><Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className="action-menu" sideOffset={5} align="end">{items.map(item=><Dropdown.Item key={item.id} className={`action-menu-item ${item.danger ? 'is-danger' : ''}`} disabled={item.disabled} onSelect={item.onSelect}>{item.icon}{item.label}</Dropdown.Item>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon" aria-hidden="true">{icon}</div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Loading({ text = '불러오는 중…' }: { text?: string }) { return <div className="loading-state" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true"/><span>{text}</span></div>; }
export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) { return <div className="error-banner" role="alert"><AlertCircle size={17} aria-hidden="true"/><span>{message}</span>{onClose && <button type="button" className="icon-button" onClick={onClose} aria-label="오류 알림 닫기"><X size={15}/></button>}</div>; }
export function Brand({ compact = false }: { compact?: boolean }) { return <div className="brand" translate="no"><span className="brand-symbol" aria-hidden="true"><ArrowUpRight size={21} strokeWidth={3}/></span>{!compact && <span>Planit<span className="brand-period">.</span></span>}</div>; }
export const uid = () => crypto.randomUUID();
export const dateLabel = (date: string) => new Date(date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
export const plainText = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent || '';

