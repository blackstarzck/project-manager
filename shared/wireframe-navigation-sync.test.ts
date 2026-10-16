import { describe, expect, it } from 'vitest';
import type { WireElement, WireScreen } from './schema';
import { detachNavigationHistory, linkNavigation, navigationIssues, synchronizeNavigation, unlinkNavigation } from './wireframe-navigation';
import { findElement, flattenElements, updateElement } from './wireframe-tree';

const node=(id:string,type:WireElement['type'],children?:WireElement[]):WireElement=>({id,type,text:id,targetScreenId:null,...(children?{children}:{})});
const screen=(id:string,elements:WireElement[]):WireScreen=>({id,name:id,revision:0,device:'desktop',flowNodeId:null,flowRevision:0,elements});
function setup(){
  let sequence=0;const uid=()=>`new-${++sequence}`;
  const source=screen('source',[node('header','header',[node('title','heading')]),node('source-body','body',[node('source-copy','text')])]);
  const target=screen('target',[node('target-header','header'),node('body','body',[node('body-copy','text')])]);
  const untouched=screen('untouched',[node('other','text')]);
  const original=[source,target,untouched];const linked=linkNavigation(original,source.id,[target.id],['header'],uid);
  return {original,linked,uid};
}
const editTitle=(screens:WireScreen[],text:string)=>screens.map(screen=>screen.id==='source'?{...screen,elements:updateElement(screen.elements,'title',element=>({...element,text}))}:screen);

describe('persistent one-way navigation synchronization',()=>{
  it('propagates source edits with stable element IDs and preserves body, unlinked screens and input',()=>{
    const {original,linked,uid}=setup();const snapshot=structuredClone(linked);
    const targetId=linked[1].navigationSync!.header!.elementIdMap.title;
    const updated=synchronizeNavigation(linked,editTitle(linked,'바뀐 공통 제목'),uid);
    expect(findElement(updated[1].elements,targetId)?.text).toBe('바뀐 공통 제목');
    expect(updated[1].navigationSync).toEqual(linked[1].navigationSync);
    expect(findElement(updated[1].elements,'body')).toEqual(original[1].elements[1]);
    expect(updated[2]).toEqual(original[2]);expect(linked).toEqual(snapshot);expect(navigationIssues(updated)).toEqual([]);
  });
  it('maps new and removed source children and preserves cross-region modal links',()=>{
    const {original,uid}=setup();original[0].elements.push(node('footer','footer',[node('dialog','modal')]));
    original[0].elements[0].children!.push({...node('open','button'),action:'openModal',targetElementId:'dialog'});
    const linked=linkNavigation(original,'source',['target'],['header','footer'],uid);
    const target=linked[1],openId=target.navigationSync!.header!.elementIdMap.open,modalId=target.navigationSync!.footer!.elementIdMap.dialog;
    expect(findElement(target.elements,openId)?.targetElementId).toBe(modalId);
    const changed=linked.map(screen=>screen.id==='source'?{...screen,elements:updateElement(screen.elements,'header',element=>({...element,children:[...element.children!.filter(item=>item.id!=='title'),node('new-title','heading')]}))}:screen);
    const updated=synchronizeNavigation(linked,changed,uid),newMap=updated[1].navigationSync!.header!.elementIdMap;
    expect(newMap.title).toBeUndefined();expect(newMap['new-title']).toBeTruthy();
    expect(findElement(updated[1].elements,openId)?.targetElementId).toBe(modalId);expect(navigationIssues(updated)).toEqual([]);
  });
  it('canonicalizes stale follower snapshots and propagates undo on the source',()=>{
    const {linked,uid}=setup();const changed=synchronizeNavigation(linked,editTitle(linked,'새 제목'),uid);
    const canonical=synchronizeNavigation(changed,[changed[0],linked[1],changed[2]],uid);
    expect(canonical[1]).toEqual(changed[1]);
    const undone=synchronizeNavigation(changed,[linked[0],changed[1],changed[2]],uid);
    expect(findElement(undone[1].elements,linked[1].navigationSync!.header!.elementIdMap.title)?.text).toBe('title');
  });
  it('unlink and source deletion retain rendered content without dangling references',()=>{
    const {linked,uid}=setup();const detached=unlinkNavigation(linked,'target',['header']);
    const changed=synchronizeNavigation(detached,editTitle(detached,'새 제목'),uid);
    expect(changed[1].elements).toEqual(linked[1].elements);expect(changed[1].navigationSync).toBeUndefined();
    const withoutSource=synchronizeNavigation(linked,linked.filter(screen=>screen.id!=='source'),uid);
    expect(withoutSource[0].elements).toEqual(linked[1].elements);expect(withoutSource[0].navigationSync).toBeUndefined();
    const withoutRegion=synchronizeNavigation(linked,linked.map(screen=>screen.id==='source'?{...screen,elements:screen.elements.filter(item=>item.id!=='header')}:screen),uid);
    expect(withoutRegion[1].elements).toEqual(linked[1].elements);expect(navigationIssues(withoutRegion)).toEqual([]);
  });
  it('rejects chains, source self-links and maps that would overwrite a body element',()=>{
    const {linked,uid}=setup();
    expect(()=>linkNavigation(linked,'target',['untouched'],['header'],uid)).toThrow('기준으로');
    const self=structuredClone(linked);self[1].navigationSync!.header!.sourceScreenId='target';self[1].navigationSync!.header!.sourceElementId=self[1].navigationSync!.header!.elementIdMap.header;
    expect(()=>synchronizeNavigation(linked,self,uid)).toThrow();
    const collision=structuredClone(linked);collision[1].navigationSync!.header!.elementIdMap.title='body-copy';
    expect(()=>synchronizeNavigation(linked,collision,uid)).toThrow('겹칩니다');
  });
  it('rejects oversized fan-out atomically before changing source or followers',()=>{
    const {linked,uid}=setup();const full=structuredClone(linked);full[1].elements.push(...Array.from({length:498-flattenElements(full[1].elements).length},(_,index)=>node(`body-${index}`,'text')));
    // Put body elements in bounded containers so only the total limit is exercised.
    const roots=full[1].elements.splice(2);for(let index=0;index<roots.length;index+=90)full[1].elements.push(node(`container-${index}`,'body',roots.slice(index,index+90)));
    while(flattenElements(full[1].elements).length>498)full[1].elements.at(-1)!.children!.pop();
    const snapshot=structuredClone(full);const changed=full.map(screen=>screen.id==='source'?{...screen,elements:updateElement(screen.elements,'header',element=>({...element,children:[...element.children!,node('extra1','text'),node('extra2','text'),node('extra3','text')]}))}:screen);
    expect(()=>synchronizeNavigation(full,changed,uid)).toThrow('500');expect(full).toEqual(snapshot);
  });
  it('keeps copied version bindings local and rejects linking different devices',()=>{
    const {linked,uid}=setup();const copy=structuredClone(linked);
    const changed=synchronizeNavigation(copy,editTitle(copy,'복제본 제목'),uid);
    expect(findElement(linked[0].elements,'title')?.text).toBe('title');expect(findElement(changed[0].elements,'title')?.text).toBe('복제본 제목');
    const mobile=linked.map(screen=>screen.id==='untouched'?{...screen,device:'mobile' as const}:screen);
    expect(()=>linkNavigation(mobile,'source',['untouched'],['header'],uid)).toThrow('같은 기기');
  });
  it('reapplying an existing binding preserves IDs and body buttons that open a shared modal',()=>{
    const {original,uid}=setup();original[0].elements[0].children!.push(node('shared-modal','modal'));
    const linked=linkNavigation(original,'source',['target'],['header'],uid);
    const targetModal=linked[1].navigationSync!.header!.elementIdMap['shared-modal'];
    linked[1].elements[1].children!.push({...node('body-open','button'),action:'openModal',targetElementId:targetModal});
    const repeated=linkNavigation(linked,'source',['target'],['header'],uid);
    expect(repeated).toEqual(linked);expect(findElement(repeated[1].elements,'body-open')?.targetElementId).toBe(targetModal);
  });
  it('removes cascaded bindings from undo snapshots while preserving unrelated body history',()=>{
    const {linked,uid}=setup();const snapshot=structuredClone(linked[1]);
    snapshot.elements=updateElement(snapshot.elements,'body-copy',element=>({...element,text:'과거 본문'}));
    const detached=synchronizeNavigation(linked,linked.map(screen=>screen.id==='source'?{...screen,elements:screen.elements.filter(item=>item.id!=='header')}:screen),uid);
    const cleaned=detachNavigationHistory(snapshot,detached[1],linked[1].navigationSync!,uid);
    expect(cleaned.navigationSync).toBeUndefined();expect(findElement(cleaned.elements,'body-copy')?.text).toBe('과거 본문');
    const sourceUndo=synchronizeNavigation(detached,[linked[0],detached[1],detached[2]],uid);
    const followerUndo=synchronizeNavigation(sourceUndo,[sourceUndo[0],cleaned,sourceUndo[2]],uid);
    expect(followerUndo[1].navigationSync).toBeUndefined();
    const explicitUnlink=unlinkNavigation(linked,'target',['header']);
    expect(synchronizeNavigation(explicitUnlink,linked,uid)[1].navigationSync).toEqual(linked[1].navigationSync);
  });
  it('detaches existing bindings on device changes and rejects crafted cross-device links',()=>{
    const {linked,uid}=setup();const mobile=linked.map(screen=>screen.id==='target'?{...screen,device:'mobile' as const}:screen);
    const detached=synchronizeNavigation(linked,mobile,uid);
    expect(detached[1].navigationSync).toBeUndefined();expect(detached[1].elements).toEqual(linked[1].elements);
    expect(navigationIssues(mobile).join()).toContain('같은 기기');expect(()=>synchronizeNavigation([],mobile,uid)).toThrow();
  });
  it('rejects a 101st screen without altering the existing version',()=>{
    const {uid}=setup();const screens=Array.from({length:100},(_,index)=>screen(`screen-${index}`,[]));
    expect(()=>synchronizeNavigation(screens,[...screens,screen('overflow',[])],uid)).toThrow('100개');expect(screens).toHaveLength(100);
  });
});
