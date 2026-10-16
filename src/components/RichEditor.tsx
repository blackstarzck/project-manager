import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, List, ListOrdered, Undo2, Redo2 } from 'lucide-react';

interface Props { value: string; onChange: (html: string) => void; placeholder?: string; label?: string; focusRequested?: boolean; onFocusHandled?: () => void }

export function RichEditor({ value, onChange, placeholder = '내용을 작성해 보세요…', label = '문서 내용', focusRequested = false, onFocusHandled }: Props) {
  const toolbar = useRef<HTMLDivElement>(null);
  const focusHandled = useRef(false), focusCallback = useRef(onFocusHandled);
  focusCallback.current = onFocusHandled;
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
    content: value,
    editorProps: { attributes: { class: 'rich-text', 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: instance }) => onChange(instance.getHTML()),
  });
  useEffect(() => {
    if (editor && value !== editor.getHTML() && !editor.isFocused) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);
  useEffect(() => {
    if (!editor || !focusRequested || focusHandled.current) return;
    let frame: number | undefined;
    const activeAtRequest = document.activeElement;
    const focusBody = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      // Tiptap's React view must finish mounting before focus. Own the frame so
      // an unmount or cancelled intent can remove it instead of stealing focus later.
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (editor.isDestroyed || focusHandled.current || !editor.view.dom.isConnected) return;
        focusHandled.current = true;
        const active = document.activeElement;
        if (active === activeAtRequest || active === document.body || active === editor.view.dom) {
          editor.view.focus();
          editor.commands.scrollIntoView();
        }
        focusCallback.current?.();
      });
    };
    focusBody();
    editor.on('create', focusBody);
    return () => {
      editor.off('create', focusBody);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [editor, focusRequested]);
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    bold: current.isActive('bold'), italic: current.isActive('italic'),
    bulletList: current.isActive('bulletList'), orderedList: current.isActive('orderedList'),
    canUndo: current.can().undo(), canRedo: current.can().redo(),
  } : null });
  if (!editor) return null;
  return <div className="rich-editor">
    <div ref={toolbar} className="rich-toolbar" role="toolbar" aria-label="텍스트 서식" onKeyDown={event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const buttons = Array.from(toolbar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      <button type="button" title="굵게" aria-label="굵게" aria-pressed={!!state?.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14}/></button>
      <button type="button" title="기울임" aria-label="기울임" aria-pressed={!!state?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14}/></button>
      <span className="toolbar-separator"/>
      <button type="button" title="글머리 목록" aria-label="글머리 목록" aria-pressed={!!state?.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15}/></button>
      <button type="button" title="번호 목록" aria-label="번호 목록" aria-pressed={!!state?.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15}/></button>
      <span className="toolbar-separator"/>
      <button type="button" title="실행 취소" aria-label="텍스트 실행 취소" disabled={!state?.canUndo} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={14}/></button>
      <button type="button" title="다시 실행" aria-label="텍스트 다시 실행" disabled={!state?.canRedo} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={14}/></button>
    </div>
    <EditorContent editor={editor}/>
  </div>;
}
