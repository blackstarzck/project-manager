import { describe, expect, it } from 'vitest';
import type { WireElement, WireScreen } from './schema';
import { applyNavigationInference, inferNavigationCandidates } from './wireframe-navigation-inference';
import { linkNavigation, navigationIssues, synchronizeNavigation } from './wireframe-navigation';
import { findElement, updateElement } from './wireframe-tree';

const node=(id:string,type:WireElement['type'],text:string,children?:WireElement[]):WireElement=>({id,type,text,targetScreenId:null,...(children?{children}:{})});
function screen(id:string,device:WireScreen['device']='desktop'):WireScreen {
  return {id,name:id,device,revision:0,flowRevision:0,flowNodeId:null,elements:[
    node(`${id}-header`,'header','',[node(`${id}-title`,'heading','서비스'),node(`${id}-nav`,'nav','내 계정')]),
    node(`${id}-body`,'body','본문',[node(`${id}-copy`,'text',`${id}의 직접 작성 내용`)]),
  ]};
}
const headerCandidate=(screens:WireScreen[])=>inferNavigationCandidates(screens).candidates.find(candidate=>candidate.region==='header')!;
const selectAll=(screens:WireScreen[])=>{const analysis=inferNavigationCandidates(screens);return applyNavigationInference(screens,analysis,analysis.candidates.map(candidate=>({candidateId:candidate.id,targetScreenIds:candidate.targetScreenIds})));};
const unique=()=>{let sequence=0;return()=>`fresh-${++sequence}`;};

describe('conservative common navigation inference',()=>{
  it('finds same-device semantic matches and applies only selected targets without changing elements',()=>{
    const screens=[screen('a'),screen('b'),screen('c'),screen('mobile','mobile'),screen('tablet','tablet')],before=structuredClone(screens);
    const analysis=inferNavigationCandidates(screens),candidate=analysis.candidates[0];
    expect(candidate).toMatchObject({region:'header',device:'desktop',sourceScreenId:'a',sourceElementId:'a-header',targetScreenIds:['b','c']});
    expect(candidate.elementIdMaps.b).toEqual({'a-header':'b-header','a-title':'b-title','a-nav':'b-nav'});
    const applied=applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['c']}]);
    expect(applied[0]).toBe(screens[0]);expect(applied[1]).toBe(screens[1]);expect(applied[3]).toBe(screens[3]);
    expect(applied[2].navigationSync!.header!.elementIdMap).toEqual(candidate.elementIdMaps.c);
    expect(applied.map(item=>item.elements)).toEqual(screens.map(item=>item.elements));
    expect(applied[2].elements).toBe(screens[2].elements);expect(screens).toEqual(before);expect(navigationIssues(applied)).toEqual([]);
    expect(inferNavigationCandidates(screens)).toEqual(analysis);
  });

  it.each(['text','order','style','action','screenTarget','table'] as const)('does not infer regions with different %s semantics',difference=>{
    const screens=[screen('a'),screen('b')];
    if(difference==='text')screens[1].elements[0].children![0].text='다른 서비스';
    if(difference==='order')screens[1].elements[0].children!.reverse();
    if(difference==='style')screens[1].elements[0].style={padding:0};
    if(difference==='action')screens[1].elements[0].children![1].action='back';
    if(difference==='screenTarget'){screens[0].elements[0].children![1].targetScreenId='a';screens[1].elements[0].children![1].targetScreenId='b';}
    if(difference==='table'){
      screens.forEach(item=>item.elements[0].children!.push({...node(`${item.id}-table`,'table','표'),columns:['항목'],rows:[['값']]}));
      screens[1].elements[0].children!.at(-1)!.rows=[['다른 값']];
    }
    expect(inferNavigationCandidates(screens).candidates).toEqual([]);
  });

  it('normalizes absent styles/empty children and style key order, but not explicit defaults or null styles',()=>{
    const screens=[screen('a'),screen('b')];
    screens[0].elements[0].style={padding:16,gap:8};screens[1].elements[0].style={gap:8,padding:16};
    screens[0].elements[0].children![0].style={};screens[1].elements[0].children![0].children=[];
    screens[0].elements[0].children![0].targetElementId=null;
    expect(headerCandidate(screens).targetScreenIds).toEqual(['b']);
    screens[1].elements[0].children![0].style={gap:0};expect(inferNavigationCandidates(screens).candidates).toEqual([]);
    screens[1].elements[0].children![0].style=null as unknown as WireElement['style'];
    expect(()=>inferNavigationCandidates(screens)).toThrow('올바르지');
  });

  it('skips empty templates, missing regions, duplicate page regions and modal-only regions',()=>{
    const empty=[screen('a'),screen('b')];empty.forEach(item=>{item.elements=[node(`${item.id}-empty`,'header','',[])];});
    const analysis=inferNavigationCandidates(empty);expect(analysis.candidates).toEqual([]);expect(analysis.skipped.some(item=>item.reason.includes('빈 영역'))).toBe(true);
    const duplicate=[screen('a'),screen('b')];duplicate[1].elements.push(node('second-header','header','서비스'));
    expect(inferNavigationCandidates(duplicate).candidates).toEqual([]);expect(inferNavigationCandidates(duplicate).skipped.some(item=>item.reason.includes('여러 개'))).toBe(true);
    const dialogs=[screen('a'),screen('b')];dialogs.forEach(item=>{item.elements=[node(`${item.id}-dialog`,'modal','안내',[node(`${item.id}-dialog-header`,'header','서비스')])];});
    expect(inferNavigationCandidates(dialogs).candidates).toEqual([]);
    expect(inferNavigationCandidates(dialogs).skipped.every(item=>item.reason.includes('없습니다'))).toBe(true);
  });

  it('maps internal modal references by structural path and preserves existing body references through later synchronization',()=>{
    const screens=[screen('a'),screen('b')];
    for(const item of screens){
      item.elements[0].children!.push({...node(`${item.id}-open`,'button','열기'),action:'openModal',targetElementId:`${item.id}-modal`},node(`${item.id}-modal`,'modal','안내',[{...node(`${item.id}-close`,'button','닫기'),action:'closeModal',targetElementId:`${item.id}-modal`}]));
      item.elements[1].children!.push({...node(`${item.id}-body-open`,'button','본문에서 열기'),action:'openModal',targetElementId:`${item.id}-modal`});
    }
    const applied=selectAll(screens);
    expect(applied[1].elements).toEqual(screens[1].elements);
    expect(applied[1].navigationSync!.header!.elementIdMap['a-modal']).toBe('b-modal');
    const changed=applied.map(item=>item.id==='a'?{...item,elements:updateElement(item.elements,'a-title',element=>({...element,text:'업데이트'}))}:item);
    const synced=synchronizeNavigation(applied,changed,unique());
    expect(findElement(synced[1].elements,'b-title')?.text).toBe('업데이트');
    expect(findElement(synced[1].elements,'b-open')?.targetElementId).toBe('b-modal');
    expect(findElement(synced[1].elements,'b-body-open')?.targetElementId).toBe('b-modal');
    expect(synced[1].elements[1]).toEqual(screens[1].elements[1]);
  });

  it('excludes cross-region and body modal references instead of clearing links',()=>{
    const screens=[screen('a'),screen('b')];
    for(const item of screens){
      item.elements.push(node(`${item.id}-footer`,'footer','문의',[node(`${item.id}-modal`,'modal','안내')]));
      item.elements[0].children!.push({...node(`${item.id}-open`,'button','열기'),action:'openModal',targetElementId:`${item.id}-modal`});
    }
    const analysis=inferNavigationCandidates(screens);
    expect(analysis.candidates.map(candidate=>candidate.region)).toEqual(['footer']);
    expect(analysis.skipped.filter(item=>item.region==='header').every(item=>item.reason.includes('모달'))).toBe(true);
    const applied=selectAll(screens);expect(applied[1].elements).toEqual(screens[1].elements);
    expect(synchronizeNavigation(applied,applied,unique())[1].elements).toEqual(screens[1].elements);
    screens.forEach(item=>{item.elements[1].children!.push(node(`${item.id}-body-modal`,'modal','안내'));findElement(item.elements,`${item.id}-open`)!.targetElementId=`${item.id}-body-modal`;});
    expect(inferNavigationCandidates(screens).candidates.some(candidate=>candidate.region==='header')).toBe(false);
  });

  it('prefers the sole existing owner without reassigning followers even when another screen comes first',()=>{
    const original=[screen('unbound'),screen('owner'),screen('follower')];
    const linked=linkNavigation(original,'owner',['follower'],['header'],unique());
    const candidate=headerCandidate(linked);
    expect(candidate.sourceScreenId).toBe('owner');expect(candidate.targetScreenIds).toEqual(['unbound']);
    const applied=selectAll(linked);expect(applied[2]).toBe(linked[2]);expect(applied[0].navigationSync!.header!.sourceScreenId).toBe('owner');
    expect(navigationIssues(applied)).toEqual([]);
  });

  it('skips ambiguous established owners instead of merging or creating chains',()=>{
    const original=[screen('one'),screen('two'),screen('one-follower'),screen('two-follower'),screen('unbound')],uid=unique();
    const linked=linkNavigation(linkNavigation(original,'one',['one-follower'],['header'],uid),'two',['two-follower'],['header'],uid);
    const analysis=inferNavigationCandidates(linked);
    expect(analysis.candidates).toEqual([]);
    expect(analysis.skipped.find(item=>item.screenId==='unbound'&&item.region==='header')?.reason).toContain('둘 이상');
    expect(applyNavigationInference(linked,analysis,[])).toBe(linked);
  });

  it('allows independent ownership of different regions without changing existing bindings',()=>{
    const screens=[screen('a'),screen('b'),screen('c')];
    screens[0].elements.push(node('a-footer','footer','문의'));screens[2].elements.push(node('c-footer','footer','문의'));
    const linked=linkNavigation(screens,'c',['a'],['footer'],unique());
    const candidate=headerCandidate(linked);expect(candidate.sourceScreenId).toBe('a');
    const applied=applyNavigationInference(linked,inferNavigationCandidates(linked),[{candidateId:candidate.id,targetScreenIds:['b']}]);
    expect(applied[0].navigationSync).toEqual(linked[0].navigationSync);expect(applied[1].navigationSync!.header!.sourceScreenId).toBe('a');
  });

  it('honors opt-out for both sources and targets while retaining explicit links',()=>{
    const screens=[screen('excluded'),screen('a'),screen('b')];screens[0].navigationInferenceExcluded=true;
    let analysis=inferNavigationCandidates(screens);expect(analysis.candidates[0].sourceScreenId).toBe('a');expect(analysis.candidates[0].targetScreenIds).toEqual(['b']);
    expect(analysis.skipped.filter(item=>item.screenId==='excluded').every(item=>item.reason==='자동 찾기에서 제외한 화면입니다.')).toBe(true);
    const linked=linkNavigation(screens,'excluded',['b'],['header'],unique());
    analysis=inferNavigationCandidates(linked);expect(analysis.candidates).toEqual([]);
    expect(applyNavigationInference(linked,analysis,[])[2].navigationSync).toEqual(linked[2].navigationSync);
  });

  it.each(['source','target','body','revision'] as const)('rejects a stale %s snapshot atomically',change=>{
    const screens=[screen('a'),screen('b')],analysis=inferNavigationCandidates(screens),changed=structuredClone(screens);
    if(change==='source')changed[0].elements[0].children![0].text='변경';
    if(change==='target')changed[1].elements[0].children![0].text='변경';
    if(change==='body')changed[1].elements[1].children![0].text='변경';
    if(change==='revision')changed[0].revision++;
    const before=structuredClone(changed);
    expect(()=>applyNavigationInference(changed,analysis,[{candidateId:analysis.candidates[0].id,targetScreenIds:['b']}])).toThrow('다시 분석');
    expect(changed).toEqual(before);
  });

  it('rejects unknown, duplicate or invalid selections before adding any binding and recomputes maps',()=>{
    const screens=[screen('a'),screen('b'),screen('c')],analysis=inferNavigationCandidates(screens),id=analysis.candidates[0].id,before=structuredClone(screens);
    for(const selections of [
      [{candidateId:'unknown',targetScreenIds:['b']}],
      [{candidateId:id,targetScreenIds:['b','b']}],
      [{candidateId:id,targetScreenIds:['a']}],
      [{candidateId:id,targetScreenIds:['b']},{candidateId:id,targetScreenIds:['c']}],
      [{candidateId:id,targetScreenIds:[]}],
      [{candidateId:id,targetScreenIds:['b']},{candidateId:'unknown',targetScreenIds:['c']}],
    ])expect(()=>applyNavigationInference(screens,analysis,selections)).toThrow();
    expect(screens).toEqual(before);
    analysis.candidates[0].elementIdMaps.b['a-title']='b-copy';
    const applied=applyNavigationInference(screens,analysis,[{candidateId:id,targetScreenIds:['b']}]);
    expect(applied[1].navigationSync!.header!.elementIdMap['a-title']).toBe('b-title');
    expect(applied[1].elements).toEqual(screens[1].elements);
  });

  it('bounds malformed trees before recursive helpers and rejects invalid existing bindings',()=>{
    const duplicate=[screen('a'),screen('b')];duplicate[0].elements[0].children![0].id='a-header';
    expect(()=>inferNavigationCandidates(duplicate)).toThrow('중복');
    const deep=screen('deep');let parent=deep.elements[0];for(let index=0;index<9;index++){const child=node(`level-${index}`,'box','');parent.children=[child];parent=child;}
    expect(()=>inferNavigationCandidates([deep])).toThrow('8단계');
    const cycle=screen('cycle');cycle.elements[0].children=[cycle.elements[0]];expect(()=>inferNavigationCandidates([cycle])).toThrow();
    const invalid=[screen('a'),screen('b')];invalid[1].navigationSync={header:{sourceScreenId:'missing',sourceElementId:'none',elementIdMap:{}}};
    expect(()=>inferNavigationCandidates(invalid)).toThrow('기준 화면');
  });
});
