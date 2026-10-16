import { describe, expect, it } from 'vitest';
import type { NavigationRegion, WireElement, WireScreen } from './schema';
import { applyNavigationInference, inferNavigationCandidates } from './wireframe-navigation-inference';
import { linkNavigation, navigationIssues, screenNavigation, synchronizeNavigation } from './wireframe-navigation';
import { findElement, flattenElements, updateElement } from './wireframe-tree';

const element=(id:string,type:WireElement['type'],text:string,children?:WireElement[]):WireElement=>({id,type,text,targetScreenId:null,...(children?{children}:{})});
const page=(id:string,device:WireScreen['device']='desktop'):WireScreen=>({id,name:`화면 ${id}`,revision:0,flowRevision:0,flowNodeId:null,device,elements:[element(`${id}-body`,'body',`수동 본문 ${id}`,[element(`${id}-text`,'text',`본문 ${id}`)])]});
function region(id:string,kind:NavigationRegion='header',label='홈'):WireElement {
  return element(`${id}-${kind}`,kind,'',[{...element(`${id}-nav`,'nav',label),action:'navigate',targetScreenId:'a'}]);
}
const pages=(kind:NavigationRegion='header')=>['a','b'].map(id=>({...page(id),elements:[region(id,kind),...page(id).elements]}));
const extended=(screens:WireScreen[])=>inferNavigationCandidates(screens,{extended:true});
const uid=()=>{let number=0;return()=>`allocated-${++number}`;};
const applyAll=(screens:WireScreen[])=>{const analysis=extended(screens);return applyNavigationInference(screens,analysis,analysis.candidates.map(candidate=>({candidateId:candidate.id,targetScreenIds:candidate.targetScreenIds,allowChanges:true})),uid());};

describe('reviewed navigation consolidation and creation',()=>{
  it('keeps default exact behavior and exposes per-target exact/similar changes in extended mode',()=>{
    const screens=[...pages(),{...page('c'),elements:[region('c'),...page('c').elements]}];
    screens[1].elements[0].children![0].text='메인';screens[1].elements[0].style={padding:32};
    expect(inferNavigationCandidates(screens).candidates[0].targetScreenIds).toEqual(['c']);
    const analysis=extended(screens),candidate=analysis.candidates[0];
    expect(analysis.options).toEqual({extended:true});expect(candidate.kind).toBe('similar');
    expect(candidate.targets.map(target=>[target.screenId,target.kind,target.destructive])).toEqual([['b','similar',true],['c','exact',false]]);
    expect(candidate.targets[0].differences).toContainEqual(expect.objectContaining({elementId:'b-nav',field:'text',before:'메인',after:'홈'}));
    expect(candidate.targets[0].differences).toContainEqual(expect.objectContaining({elementId:'b-header',field:'style',before:{padding:32},after:{}}));
    expect(()=>applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['c','b']}])).toThrow('확인한 대상');
    const exactOnly=applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['c']}]);
    expect(exactOnly[1]).toBe(screens[1]);expect(exactOnly[2].navigationSync).toBeDefined();
    const applied=applyAll(screens);expect(findElement(applied[1].elements,'b-nav')?.text).toBe('홈');
    expect(applied[1].elements[1]).toEqual(screens[1].elements[1]);expect(applied[1].navigationSync!.header!.elementIdMap['a-nav']).toBe('b-nav');
  });

  it.each(['headingText','headingStyle','bodyText','bodyStyle','table','destination','action','order','unconfiguredLabel'] as const)('does not broaden similar matching across %s differences',difference=>{
    const screens=pages();
    for(const screen of screens){
      screen.elements[0].children!.push(element(`${screen.id}-heading`,'heading','계정'),element(`${screen.id}-nested-body`,'body','요약'),{...element(`${screen.id}-table`,'table','목록'),columns:['이름'],rows:[['값']]});
    }
    const target=screens[1].elements[0].children!;
    if(difference==='headingText')target[1].text='새 제목';
    if(difference==='headingStyle')target[1].style={fontSize:24};
    if(difference==='bodyText')target[2].text='다른 요약';
    if(difference==='bodyStyle')target[2].style={padding:24};
    if(difference==='table')target[3].rows=[['변경']];
    if(difference==='destination')target[0].targetScreenId='b';
    if(difference==='action')target[0].action='back';
    if(difference==='order')target.reverse();
    if(difference==='unconfiguredLabel'){for(const screen of screens){screen.elements[0].children![0].targetScreenId=null;delete screen.elements[0].children![0].action;}target[0].text='다른 메뉴';}
    expect(extended(screens).candidates).toEqual([]);
  });

  it('retains positional IDs and body-to-modal references while normalizing reviewed menu text/styles',()=>{
    const screens=pages();
    for(const screen of screens){
      screen.elements[0].children!.push({...element(`${screen.id}-open`,'button',screen.id==='a'?'열기':'모달 열기'),action:'openModal',targetElementId:`${screen.id}-modal`},element(`${screen.id}-modal`,'modal','안내',[{...element(`${screen.id}-close`,'button','닫기'),action:'closeModal'}]));
      screen.elements[1].children!.push({...element(`${screen.id}-body-open`,'button','본문 동작'),action:'openModal',targetElementId:`${screen.id}-modal`});
    }
    const originalIds=flattenElements(screens[1].elements).map(item=>item.id),applied=applyAll(screens);
    expect(flattenElements(applied[1].elements).map(item=>item.id)).toEqual(originalIds);
    expect(findElement(applied[1].elements,'b-open')).toMatchObject({text:'열기',targetElementId:'b-modal'});
    expect(findElement(applied[1].elements,'b-body-open')?.targetElementId).toBe('b-modal');
    expect(applied[1].elements[1]).toEqual(screens[1].elements[1]);
    expect(navigationIssues(applied)).toEqual([]);
    const changed=applied.map(screen=>screen.id==='a'?{...screen,elements:updateElement(screen.elements,'a-nav',item=>({...item,text:'업데이트'}))}:screen);
    expect(findElement(synchronizeNavigation(applied,changed,uid())[1].elements,'b-nav')?.text).toBe('업데이트');
  });

  it.each(['header','sidebar','footer'] as const)('adds a truly missing %s from one source family with new IDs and preserves existing bodies',kind=>{
    const screens=[{...page('a'),elements:[region('a',kind),...page('a').elements]},page('b')],before=structuredClone(screens);
    const analysis=extended(screens),candidate=analysis.candidates[0];
    expect(inferNavigationCandidates(screens).candidates).toEqual([]);
    expect(candidate.targets).toEqual([expect.objectContaining({screenId:'b',kind:'missing',destructive:false})]);
    expect(candidate.sourcePreview).toEqual(screens[0].elements[0]);expect(candidate.sourcePreview).not.toBe(screens[0].elements[0]);
    candidate.sourcePreview!.children![0].text='위조 미리보기';candidate.sourcePreview!.children![0].targetScreenId='없는 화면';
    expect(()=>applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['b']}])).toThrow('확인한 대상');
    let calls=0;const nextId=uid();
    const applied=applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['b'],allowChanges:true}],()=>++calls===1?'a-body':nextId());
    expect(applied[0]).toBe(screens[0]);expect(screens).toEqual(before);
    expect(findElement(applied[1].elements,'b-body')).toEqual(screens[1].elements[0]);
    const created=screenNavigation(applied[1]).find(item=>item.type===kind)!.element;
    expect(created.id).not.toBe(`a-${kind}`);expect(applied[1].navigationSync![kind]!.sourceElementId).toBe(`a-${kind}`);
    expect(created.children![0]).toMatchObject({text:'홈',targetScreenId:'a'});
    expect(navigationIssues(applied)).toEqual([]);
  });

  it('keeps an existing owner over similar free sources and skips conflicting source families or multiple owners',()=>{
    let screens=[...pages(),page('missing'),{...page('follower'),elements:[region('follower'),...page('follower').elements]}];
    screens[0].elements[0].children![0].text='메인';
    screens=linkNavigation(screens,'b',['follower'],['header'],uid());
    const candidate=extended(screens).candidates[0];expect(candidate.sourceScreenId).toBe('b');expect(candidate.targetScreenIds).toEqual(['a','missing']);
    expect(candidate.targets.map(target=>target.kind)).toEqual(['similar','missing']);
    const twoOwners=linkNavigation([...screens,{...page('another-follower'),elements:[region('another-follower'),...page('another-follower').elements]}],'a',['another-follower'],['header'],uid());
    expect(extended(twoOwners).candidates).toEqual([]);
    const families=[...pages(),page('missing')];families[1].elements[0].children![0].targetScreenId='b';
    expect(extended(families).candidates).toEqual([]);
    expect(extended(families).skipped.some(item=>item.screenId==='missing'&&item.reason.includes('여러 종류'))).toBe(true);
  });

  it('generates a grounded header only after review, creates it on source and selected pages, and excludes opt-outs/devices',()=>{
    const screens=[page('a'),page('b'),page('c'),{...page('excluded'),navigationInferenceExcluded:true},page('mobile','mobile')],before=structuredClone(screens);
    expect(inferNavigationCandidates(screens).candidates).toEqual([]);
    const analysis=extended(screens),candidate=analysis.candidates[0];
    expect(candidate.kind).toBe('generated');expect(candidate.sourceScreenId).toBe('a');expect(candidate.targetScreenIds).toEqual(['b','c']);
    expect(candidate.sourceChanges?.[0].message).toContain('기준 화면에도');
    expect(candidate.sourcePreview?.children?.map(item=>[item.text,item.targetScreenId])).toEqual([['화면 a','a'],['화면 b','b'],['화면 c','c']]);
    expect(applyNavigationInference(screens,analysis,[])).toBe(screens);
    const applied=applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['b'],allowChanges:true}],uid());
    expect(screens).toEqual(before);expect(applied[2]).toBe(screens[2]);expect(applied[3]).toBe(screens[3]);expect(applied[4]).toBe(screens[4]);
    expect(applied[0].elements[1]).toEqual(screens[0].elements[0]);expect(applied[1].elements[1]).toEqual(screens[1].elements[0]);
    expect(applied[1].elements[0].children?.map(item=>item.targetScreenId)).toEqual(['a','b','c']);
    expect(applied[1].navigationSync!.header!.sourceScreenId).toBe('a');expect(applied[0].navigationSync).toBeUndefined();
    const allIds=applied.flatMap(screen=>flattenElements(screen.elements).map(item=>item.id));expect(new Set(allIds).size).toBe(allIds.length);
    expect(navigationIssues(applied)).toEqual([]);
  });

  it('does not generate when one eligible page already has a common region and never treats an empty region as missing',()=>{
    const screens=[page('a'),page('b')];screens[0].elements.push(element('empty-header','header',''));
    expect(extended(screens).candidates).toEqual([]);
    const source={...page('source'),elements:[region('source'),...page('source').elements]};source.elements[0].children![0].targetScreenId='source';
    const withSource=[source,...screens];
    expect(extended(withSource).candidates[0].targetScreenIds).toEqual(['b']);
  });

  it('excludes external modal dependencies and invalid options without changing existing data',()=>{
    const screens=pages();for(const screen of screens){screen.elements[1].children!.push(element(`${screen.id}-modal`,'modal','안내'));screen.elements[0].children!.push({...element(`${screen.id}-open`,'button','열기'),action:'openModal',targetElementId:`${screen.id}-modal`});}
    expect(extended([...screens,page('missing')]).candidates).toEqual([]);
    expect(()=>inferNavigationCandidates(screens,{extended:'yes'} as never)).toThrow('옵션');
    expect(()=>inferNavigationCandidates(screens,{extended:true,extra:true} as never)).toThrow('옵션');
  });

  it('enforces sibling and UID bounds atomically even when an earlier selected target would succeed',()=>{
    const screens=[{...page('a'),elements:[region('a'),...page('a').elements]},page('b'),page('full')];
    screens[2].elements=Array.from({length:100},(_,index)=>element(`full-${index}`,'text','본문'));
    const before=structuredClone(screens),analysis=extended(screens);
    expect(()=>applyNavigationInference(screens,analysis,[{candidateId:analysis.candidates[0].id,targetScreenIds:['b','full'],allowChanges:true}],uid())).toThrow();
    expect(screens).toEqual(before);
    expect(()=>applyNavigationInference(screens,analysis,[{candidateId:analysis.candidates[0].id,targetScreenIds:['b'],allowChanges:true}],()=> 'a-header')).toThrow('새 요소 ID');
    expect(screens).toEqual(before);
    const generated=[page('a'),page('b')];generated[0].elements=Array.from({length:100},(_,index)=>element(`source-${index}`,'text','본문'));
    const generatedBefore=structuredClone(generated),draft=extended(generated);
    expect(()=>applyNavigationInference(generated,draft,[{candidateId:draft.candidates[0].id,targetScreenIds:['b'],allowChanges:true}],uid())).toThrow();
    expect(generated).toEqual(generatedBefore);
  });

  it.each(['element-count','wrapper-depth'] as const)('rejects missing-region creation exceeding %s without partial edits',limit=>{
    const kind=limit==='wrapper-depth'?'sidebar':'header';
    const screens=[{...page('a'),elements:[region('a',kind),...page('a').elements]},page('b')];
    if(limit==='element-count')screens[1].elements=Array.from({length:10},(_,index)=>element(`container-${index}`,'body','',Array.from({length:49},(_,child)=>element(`leaf-${index}-${child}`,'text','기존 내용'))));
    else {
      const root=element('depth-root','box','');let parent=root;
      for(let index=0;index<6;index++){const child=element(`depth-${index}`,'box','');parent.children=[child];parent=child;}
      screens[1].elements=[root];
    }
    const before=structuredClone(screens),analysis=extended(screens);
    expect(()=>applyNavigationInference(screens,analysis,[{candidateId:analysis.candidates[0].id,targetScreenIds:['b'],allowChanges:true}],uid())).toThrow('500개, 중첩 8단계');
    expect(screens).toEqual(before);
  });

  it('revalidates snapshots, target choice and computed changes instead of trusting forged preview or maps',()=>{
    const screens=[page('a'),page('b')],analysis=extended(screens),candidate=analysis.candidates[0];
    candidate.sourcePreview!.children![0].targetScreenId='forged';candidate.sourcePreview!.children![0].text='위조';
    const applied=applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['b'],allowChanges:true}],uid());
    expect(applied[0].elements[0].children![0]).toMatchObject({text:'화면 a',targetScreenId:'a'});
    const changed=structuredClone(screens);changed[1].name='변경 이름';
    expect(()=>applyNavigationInference(changed,analysis,[{candidateId:candidate.id,targetScreenIds:['b'],allowChanges:true}],uid())).toThrow('다시 분석');
    expect(()=>applyNavigationInference(screens,analysis,[{candidateId:candidate.id,targetScreenIds:['b','b'],allowChanges:true}],uid())).toThrow('중복');
  });
});
