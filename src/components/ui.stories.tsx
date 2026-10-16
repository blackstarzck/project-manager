import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as Tabs from '@radix-ui/react-tabs';
import { MoreHorizontal, Check, Download, Copy, Trash2 } from 'lucide-react';
import { ActionMenu, Button, ErrorBanner, Loading, Modal, TextField, Tooltip } from './ui';

const meta = { title: 'Planit/공통 UI', parameters: { docs: { description: { component: '합성 데이터만 사용하는 공통 UI 상태. Tab·방향키·Enter·Space·Esc로 동작을 확인합니다.' } } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function States() {
  return <div style={{ maxWidth: 900, display: 'grid', gap: 24 }}>
    <section aria-label="버튼 상태"><h2>버튼</h2><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <Button><Check size={16}/>선택한 변경 승인</Button><Button variant="secondary"><Download size={16}/>내보내기</Button><Button variant="ghost">나중에 검토</Button><Button variant="danger">삭제</Button>
      <Button autoFocus variant="secondary">키보드 포커스</Button><Button disabled>사용할 수 없음</Button><Button loading>저장 중…</Button>
      <Button>선택한 한국어 변경 사항 12개를 현재 문서에 반영하기</Button>
    </div></section>
    <section aria-label="입력 상태"><h2>입력</h2><TextField label="프로젝트 이름" defaultValue="이웃과 함께하는 산책 서비스" help="한글과 영문을 함께 사용할 수 있습니다."/><TextField label="비활성 입력" disabled value="변경 처리 중입니다" readOnly/><TextField label="오류 입력" defaultValue="" error="프로젝트 이름을 입력해 주세요."/><TextField label="긴 한국어 입력" defaultValue="복잡한 서비스의 사용자 경험과 정보 구조를 함께 정리하는 프로젝트"/></section>
    <section aria-label="상태 메시지"><h2>상태 안내</h2><Loading text="변경안을 생성하고 있습니다…"/><ErrorBanner message="저장하지 못했습니다. 작성한 내용은 유지됩니다. 연결을 확인하고 다시 저장해 주세요."/><p role="status"><Check size={16} aria-hidden="true"/> 변경 사항을 저장했습니다.</p></section>
  </div>;
}
export const ComponentStates: Story = { render: () => <States/> };

function Interactive() {
  const [dialog, setDialog] = useState(false), [busy, setBusy] = useState(false), [tab, setTab] = useState('prd'), [selection, setSelection] = useState('선택한 작업이 없습니다.');
  return <div style={{ maxWidth: 800, display: 'grid', gap: 24 }}>
    <Tabs.Root value={tab} onValueChange={setTab} activationMode="manual"><nav className="document-navigation"><Tabs.List className="document-tabs" aria-label="기획 문서">{[['prd','PRD'],['features','기능명세'],['flow','유저 플로우'],['wireframe','와이어프레임']].map(([id,label])=><Tabs.Trigger id={`sample-tab-${id}`} key={id} value={id} className={`document-tab ${tab===id?'active':''}`}>{label}</Tabs.Trigger>)}</Tabs.List></nav>{['prd','features','flow','wireframe'].map(id=><Tabs.Content aria-labelledby={`sample-tab-${id}`} key={id} value={id} style={{padding:24}}>{id} 문서 편집 영역</Tabs.Content>)}</Tabs.Root>
    <div style={{display:'flex',gap:12}}><Tooltip label="프로젝트 작업 메뉴"><span><ActionMenu trigger={<button className="icon-button" aria-label="프로젝트 메뉴"><MoreHorizontal/></button>} items={[{id:'copy',label:'프로젝트 복제',icon:<Copy size={16}/>,onSelect:()=>setSelection('복제를 선택했습니다.')},{id:'delete',label:'휴지통으로 이동',icon:<Trash2 size={16}/>,danger:true,onSelect:()=>setSelection('휴지통 이동을 선택했습니다.')}]}/></span></Tooltip><Button onClick={()=>setDialog(true)}>변경 검토 열기</Button></div>
    <p role="status">{selection}</p>
    {dialog && <Modal title="AI 변경 검토" busy={busy} description="합성 변경안의 승인 상태와 포커스 이동을 확인합니다." onClose={()=>setDialog(false)} footer={<><Button variant="secondary" disabled={busy} onClick={()=>setDialog(false)}>취소</Button><Button loading={busy} onClick={()=>{setBusy(true);setTimeout(()=>{setBusy(false);setDialog(false);setSelection('선택한 변경 사항 3개를 반영했습니다.');},1500);}}>선택 승인 3</Button></>}><TextField label="검토 의견" placeholder="변경 사항에 대한 의견을 작성하세요."/><p className="help-copy">승인 중에는 중복 제출과 대화상자 닫기가 제한됩니다. 완료되면 열기 버튼으로 포커스가 돌아옵니다.</p>{Array.from({length:8},(_,index)=><p key={index}>변경 {index+1} · 긴 한글 설명에서도 내용과 버튼이 잘리지 않아야 합니다.</p>)}</Modal>}
  </div>;
}
export const KeyboardInteractions: Story = { render: () => <Interactive/> };
