import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import type { AIProvider } from './provider.js';
import { selectedVersion, selectedWireframeVersion } from './documents.js';
import { applyNavigationInference, inferNavigationCandidates } from '../shared/wireframe-navigation-inference.js';
import { navigationIssues } from '../shared/wireframe-navigation.js';
import type { AiRun, Project, Proposal, WireScreen, WireframeGenerationMode } from '../shared/schema.js';

type App=Awaited<ReturnType<typeof createApp>>;
const apps:App[]=[],directories:string[]=[];
const headers={'x-requested-with':'ProjectManager','content-type':'application/json'};
const node=(id:string)=>({id,type:'page',label:id,description:'',position:{x:0,y:0},featureIds:[],sectionId:null});
const screen=(id:string):WireScreen=>({id,name:id,flowNodeId:id,flowRevision:1,revision:0,device:'desktop',elements:[{id:`${id}-header`,type:'header',text:'서비스 메뉴',targetScreenId:null,children:[{id:`${id}-nav`,type:'nav',text:'홈',targetScreenId:null}]},{id:`${id}-body`,type:'body',text:`${id}의 고유 본문`,targetScreenId:null}]});
async function make(generate:AIProvider['generate']=async()=>{throw Error('Unexpected provider call');},dbPath=':memory:'){
  const app=await createApp({provider:{configured:true,model:'fixture-no-network',generate},dbPath});apps.push(app);return app;
}
async function send(app:App,method:'POST'|'PUT',url:string,payload:unknown){return app.inject({method,url,headers,payload:JSON.stringify(payload)});}
async function save(app:App,p:Project,wireframes:WireScreen[]){
  const response=await send(app,'PUT',`/api/projects/${p.id}/artifacts/wireframes`,{expectedRevision:p.artifactRevisions.wireframes,flowVersionId:p.selectedFlowVersionId,wireframeVersionId:p.selectedWireframeVersionId,value:wireframes});
  expect(response.statusCode,response.body).toBe(200);return response.json<Project>();
}
async function seed(app:App){
  let p=(await send(app,'POST','/api/projects',{name:'공통 영역 자동 찾기'})).json<Project>();
  const response=await send(app,'PUT',`/api/projects/${p.id}/artifacts/flow`,{expectedRevision:p.artifactRevisions.flow,flowVersionId:p.selectedFlowVersionId,value:{nodes:['excluded','included','default','new-page'].map(node),edges:[],sections:[]}});
  expect(response.statusCode,response.body).toBe(200);p=response.json<Project>();
  return save(app,p,[{...screen('excluded'),navigationInferenceExcluded:true},{...screen('included'),navigationInferenceExcluded:false},screen('default')]);
}
async function run(app:App,p:Project,mode:WireframeGenerationMode,entityIds:string[]){
  const started=await send(app,'POST',`/api/projects/${p.id}/ai/runs`,{artifact:'wireframes',prompt:'선택한 화면 내용을 개선해 주세요',wireframeGenerationMode:mode,flowVersionId:p.selectedFlowVersionId,wireframeVersionId:p.selectedWireframeVersionId,entityIds});
  expect(started.statusCode,started.body).toBe(202);const id=started.json<AiRun>().id;
  for(let index=0;index<200;index++){
    const current=(await app.inject(`/api/ai/runs/${id}`)).json<AiRun>();
    if(!['running','queued'].includes(current.status)){expect(current.status,current.error||'').toBe('succeeded');return current;}
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  throw Error('Fixture job timeout');
}
async function approve(app:App,run:AiRun){
  const response=await send(app,'POST',`/api/proposals/${run.proposalId}/resolve`,{action:'approve',commandId:crypto.randomUUID()});
  expect(response.statusCode,response.body).toBe(200);return response.json<{project:Project;proposal:Proposal}>().project;
}
const flags=(screens:WireScreen[])=>screens.map(item=>({name:item.name,excluded:item.navigationInferenceExcluded}));
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('server-owned navigation discovery policy',()=>{
  it.each(['edit','regenerate'] as const)('preserves true, false and absent policy through %s despite attempted model overrides',async mode=>{
    let calls=0;
    const app=await make(async({prompt,system})=>{
      calls++;expect(system).not.toContain('"navigationInferenceExcluded"');
      const context=JSON.parse(prompt);
      return {summary:'화면 개선',document:context.project.wireframes.filter((item:WireScreen)=>context.entityIds.includes(item.id)).map((item:WireScreen)=>({...item,name:`개선 ${item.name}`,navigationInferenceExcluded:!item.navigationInferenceExcluded}))};
    });
    const p=await seed(app),source=structuredClone(selectedWireframeVersion(p));
    const completed=await run(app,p,mode,p.wireframes.map(item=>item.id));
    expect((await app.inject(`/api/projects/${p.id}`)).json<Project>()).toEqual(p);
    const applied=await approve(app,completed);
    expect(applied.wireframes.map(item=>item.navigationInferenceExcluded)).toEqual([true,false,undefined]);
    expect(applied.wireframes.map(item=>item.name)).toEqual(['개선 excluded','개선 included','개선 default']);
    expect(calls).toBe(mode==='edit'?1:3);
    if(mode==='regenerate')expect(selectedVersion(applied).wireframeVersions.find(item=>item.id===source.id)).toEqual(source);
  });

  it('strips attempted inference exclusions and bindings from newly appended model screens',async()=>{
    const app=await make(async()=>({summary:'신규 화면',document:[{...screen('new-page'),navigationInferenceExcluded:true,navigationSync:{header:{sourceScreenId:'excluded',sourceElementId:'excluded-header',elementIdMap:{'excluded-header':'new-page-header','excluded-nav':'new-page-nav'}}}}]}));
    const p=await seed(app),completed=await run(app,p,'append',['new-page']),applied=await approve(app,completed);
    expect(applied.wireframes.slice(0,3)).toEqual(p.wireframes);
    const created=applied.wireframes.find(item=>item.id==='new-page')!;
    expect(created.navigationInferenceExcluded).toBeUndefined();expect(created.navigationSync).toBeUndefined();
    const candidate=inferNavigationCandidates(applied.wireframes).candidates.find(item=>item.region==='header')!;
    expect(candidate.sourceScreenId).toBe('included');expect(candidate.targetScreenIds).toEqual(['default','new-page']);
  });

  it('persists inferred bindings and exclusions through version copy, project copy, backup import and SQLite restart',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'planit-inference-'));directories.push(directory);const dbPath=path.join(directory,'workspace.sqlite');
    let app=await make(undefined,dbPath),p=await seed(app);
    const analysis=inferNavigationCandidates(p.wireframes),candidate=analysis.candidates[0],before=structuredClone(p.wireframes);
    p=await save(app,p,applyNavigationInference(p.wireframes,analysis,[{candidateId:candidate.id,targetScreenIds:candidate.targetScreenIds}]));
    expect(p.wireframes.map(item=>item.elements)).toEqual(before.map(item=>item.elements));
    expect(p.wireframes[2].navigationSync!.header!.sourceScreenId).toBe('included');
    const original=structuredClone(selectedWireframeVersion(p));
    const copy=await send(app,'POST',`/api/projects/${p.id}/flow-versions/${p.selectedFlowVersionId}/wireframe-versions`,{expectedRevision:p.revision,sourceWireframeVersionId:p.selectedWireframeVersionId});
    expect(copy.statusCode,copy.body).toBe(201);p=copy.json<Project>();expect(p.wireframes).toEqual(original.wireframes);
    const backup=(await app.inject(`/api/projects/${p.id}/backup`)).json();
    const imported=(await send(app,'POST','/api/backups/restore',backup)).json<Project>();
    const duplicated=(await send(app,'POST',`/api/projects/${p.id}/duplicate`,{})).json<Project>();
    for(const project of [imported,duplicated]){
      expect(selectedVersion(project).wireframeVersions).toHaveLength(2);
      for(const version of selectedVersion(project).wireframeVersions){
        expect(flags(version.wireframes)).toEqual(flags(original.wireframes));
        expect(navigationIssues(version.wireframes)).toEqual([]);
        expect(version.wireframes[2].navigationSync!.header!.sourceScreenId).toBe(version.wireframes[1].id);
        expect(version.wireframes[1].id).not.toBe('included');
        expect(inferNavigationCandidates(version.wireframes).skipped.find(item=>item.screenId===version.wireframes[0].id&&item.region==='header')?.reason).toContain('제외한 화면');
      }
    }
    const expected=structuredClone(p);await app.close();apps.splice(apps.indexOf(app),1);app=await make(undefined,dbPath);
    expect((await app.inject(`/api/projects/${p.id}`)).json<Project>()).toEqual(expected);
  });
});
