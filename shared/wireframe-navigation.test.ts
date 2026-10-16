import { describe, expect, it } from 'vitest';
import type { WireElement, WireScreen } from './schema.js';
import { applyNavigation, screenNavigation } from '../src/wireframe-navigation';
import { flattenElements } from '../src/wireframe-tree';

const node=(id:string,type:WireElement['type'],children?:WireElement[]):WireElement=>({id,type,text:id,targetScreenId:null,...(children?{children}:{})});
const screen=(id:string,elements:WireElement[]):WireScreen=>({id,name:id,revision:0,device:'desktop',flowNodeId:null,flowRevision:0,elements});
describe('explicit common navigation copying',()=>{
  it('remaps links across selected regions and preserves source, body and unselected screens',()=>{
    const button={...node('open','button'),action:'openModal' as const,targetElementId:'dialog'};
    const source=screen('source',[node('header','header',[button]),node('footer','footer',[node('dialog','modal')])]);
    const target=screen('target',[node('old-header','header'),node('body','body',[node('manual','text')]),node('old-footer','footer')]);
    const untouched=screen('untouched',[node('other','text')]);let sequence=0;
    const [original,updated,other]=applyNavigation([source,target,untouched],'source',['target'],['header','footer'],()=>`fresh-${++sequence}`);
    const nodes=flattenElements(updated.elements),copiedButton=nodes.find(item=>item.type==='button')!,copiedModal=nodes.find(item=>item.type==='modal')!;
    expect(copiedButton.targetElementId).toBe(copiedModal.id);
    expect(copiedModal.id).not.toBe('dialog');expect(new Set(nodes.map(item=>item.id)).size).toBe(nodes.length);
    expect(updated.elements.find(item=>item.id==='body')).toEqual(target.elements[1]);
    expect(original).toBe(source);expect(other).toBe(untouched);
  });
  it('does not offer dialog-only or nested navigation regions as page regions',()=>{
    const source=screen('source',[node('dialog','modal',[node('dialog-header','header')]),node('main-header','header',[node('nested-sidebar','sidebar')]),node('row','row',[node('main-sidebar','sidebar')])]);
    expect(screenNavigation(source).map(region=>region.element.id)).toEqual(['main-header','main-sidebar']);
  });
});
