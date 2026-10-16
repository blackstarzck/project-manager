import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { WireElement } from '../../shared/schema';

const headerText = (columns: string[]) => columns.join(' | ');
const rowText = (rows: string[][]) => rows.map(row => row.join(' | ')).join('\n');

export function WireframeTableInspector({ element, disabled, onPatch }: {
  element: WireElement; disabled: boolean; onPatch: (patch: Partial<WireElement>) => void;
}) {
  const columns = element.columns || [], rows = element.rows || [];
  const signature = JSON.stringify({ columns, rows });
  const expected = useRef(signature);
  const [headers, setHeaders] = useState(() => headerText(columns));
  const [data, setData] = useState(() => rowText(rows));
  const [headerError, setHeaderError] = useState(''), [rowError, setRowError] = useState('');

  useEffect(() => {
    // Own edits retain the raw delimiters/caret text; undo and external updates
    // replace the buffers from the authoritative document.
    if (signature !== expected.current) {
      expected.current = signature;
      const value = JSON.parse(signature) as { columns: string[]; rows: string[][] };
      setHeaders(headerText(value.columns)); setData(rowText(value.rows));
      setHeaderError(''); setRowError('');
    }
  }, [signature]);

  const patch = (nextColumns: string[], nextRows: string[][]) => {
    expected.current = JSON.stringify({ columns: nextColumns, rows: nextRows });
    onPatch({ columns: nextColumns, rows: nextRows });
  };
  const rename = (value: string) => {
    setHeaders(value);
    const parts = value.split('|').map(text => text.trim());
    if (parts.length > 12 || parts.some(text => text.length > 200)) {
      setHeaderError('열은 12개, 각 제목은 200자까지 입력할 수 있어요.'); return;
    }
    setHeaderError('');
    const width = Math.max(parts.length, columns.length, ...rows.map(row => row.length));
    // Renaming never removes a column or its cells, even while the user has
    // temporarily erased the delimiter. Column deletion is a separate action.
    patch(Array.from({ length: width }, (_, index) => parts[index] ?? columns[index] ?? `열 ${index + 1}`), rows);
  };
  const editRows = (value: string) => {
    setData(value);
    const nextRows = value === '' ? [] : value.split('\n').map(row => row.split('|').map(cell => cell.trim()));
    if (nextRows.length > 100 || nextRows.some(row => row.length > 12 || row.some(cell => cell.length > 2000))) {
      setRowError('표는 100행·12열, 각 셀은 2,000자까지 입력할 수 있어요.'); return;
    }
    setRowError('');
    const width = Math.max(columns.length, ...nextRows.map(row => row.length));
    const nextColumns = Array.from({ length: width }, (_, index) => columns[index] ?? `열 ${index + 1}`);
    if (nextColumns.length !== columns.length) setHeaders(headerText(nextColumns));
    patch(nextColumns, nextRows);
  };
  const replaceStructure = (nextColumns: string[], nextRows: string[][]) => {
    setHeaders(headerText(nextColumns)); setData(rowText(nextRows));
    setHeaderError(''); setRowError(''); patch(nextColumns, nextRows);
  };

  return <>
    <label>열 제목 (|로 구분)<input aria-label="표 열 제목" value={headers} onChange={event => rename(event.target.value)} onBlur={() => { if (!headerError) setHeaders(headerText(columns)); }} disabled={disabled}/></label>
    {headerError && <p className="wf-table-error" role="alert">{headerError} 변경 내용을 확인해 주세요.</p>}
    <p className="wf-table-help">제목을 바꿔도 기존 셀은 유지돼요. 열을 없애려면 아래 삭제 버튼을 사용하세요.</p>
    <div className="wf-table-columns" aria-label="표 열 관리">
      {columns.map((column, index) => <div className="wf-table-column" key={index}><span title={column}>{index + 1}. {column || '제목 없음'}</span><button className="icon-button" aria-label={`표 ${index + 1}열 삭제`} title="열과 해당 셀 삭제 · 실행 취소 가능" disabled={disabled || columns.length <= 1} onClick={() => replaceStructure(columns.filter((_, position) => position !== index), rows.map(row => row.filter((_, position) => position !== index)))}><X size={12}/></button></div>)}
      <button className="text-button small" disabled={disabled || columns.length >= 12} onClick={() => replaceStructure([...columns, `열 ${columns.length + 1}`], rows.map(row => [...row, '']))}><Plus size={12}/>열 추가</button>
    </div>
    <label>행 데이터 (줄마다 한 행)<textarea aria-label="표 행 데이터" rows={5} value={data} onChange={event => editRows(event.target.value)} onBlur={() => { if (!rowError) setData(rowText(rows)); }} disabled={disabled}/></label>
    {rowError && <p className="wf-table-error" role="alert">{rowError} 변경 내용을 확인해 주세요.</p>}
  </>;
}
