import { describe, expect, it } from 'vitest';
import { receivedWireframeScreens } from './wireframe-stream.js';
import type { WireElement } from './schema.js';

const screen=(id:string,name=id)=>({id,name,device:'tablet',revision:0,flowNodeId:null,flowRevision:0,elements:[{id:`${id}-title`,type:'heading',text:'괄호 { [ ] }와 "인용" \\ 내용',targetScreenId:null}]});
describe('wireframe streaming receipts',()=>{
  it('counts only completed validated screens before the document finishes',()=>{
    const first=JSON.stringify(screen('first','도서 검색'));
    const second=JSON.stringify(screen('second','도서 상세'));
    const prefix=`{"summary":"진행 중","document":[${first},`;
    expect(receivedWireframeScreens(prefix+second.slice(0,-1))).toEqual([{id:'first',name:'도서 검색'}]);
    expect(receivedWireframeScreens(prefix+second)).toEqual([{id:'first',name:'도서 검색'},{id:'second',name:'도서 상세'}]);
  });
  it('ignores a document array mentioned in strings or nested metadata',()=>{
    const text=JSON.stringify({summary:'"document": [{"id":"fake"}]',metadata:{document:[screen('nested')]},document:[screen('real')]});
    expect(receivedWireframeScreens(text)).toEqual([{id:'real',name:'real'}]);
  });
  it('does not count malformed, incomplete, invalid or duplicate screen data',()=>{
    expect(receivedWireframeScreens('{"document":[{"id":"partial"')).toEqual([]);
    expect(receivedWireframeScreens(JSON.stringify({document:[{id:'bad'},screen('same'),screen('same')]}))).toEqual([{id:'same',name:'same'}]);
    expect(receivedWireframeScreens('{"document":[{"id":bad},')).toEqual([]);
  });
  it('bounds nested input and element counts before recursive validation',()=>{
    let element:WireElement={id:'leaf',type:'text',text:'value',targetScreenId:null};
    for(let index=0;index<9;index++)element={id:`nest-${index}`,type:'column',text:'',targetScreenId:null,children:[element]};
    expect(receivedWireframeScreens(JSON.stringify({document:[{...screen('deep'),elements:[element]}]}))).toEqual([]);
    const nodes=Array.from({length:501},(_,index)=>({id:`node-${index}`,type:'text',text:'',targetScreenId:null}));
    expect(receivedWireframeScreens(JSON.stringify({document:[{...screen('large'),elements:nodes}]}))).toEqual([]);
  });
});
