import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import type { AIProvider } from './provider.js';
import type { AiRun, FlowDocument, FlowGenerationMode, Project, Proposal } from '../shared/schema.js';

type App = Awaited<ReturnType<typeof createApp>>;
const apps:App[] = [], directories:string[] = [];
const headers = {'x-requested-with':'ProjectManager','content-type':'application/json'};
const node = (id:string) => ({id,type:'page' as const,label:id,description:'',position:{x:0,y:0},featureIds:[] as string[],sectionId:null});
const oldFlow:FlowDocument = {nodes:[node('old-page')],edges:[],sections:[]};
const newFlow:FlowDocument = {nodes:[node('new-page')],edges:[],sections:[]};
const count = (p:Project) => p.flowGroups.reduce((total,group)=>total+group.versions.length,0);
const provider = (generate:AIProvider['generate']):AIProvider => ({model:'fixture',configured:true,generate});
async function make(generate:AIProvider['generate']=async()=>({summary:'새 사용자 여정',document:newFlow}),dbPath?:string){const app=await createApp({provider:provider(generate),dbPath});apps.push(app);return app;}
async function request(app:App,method:'POST'|'PUT'|'PATCH',url:string,payload:unknown){return app.inject({method,url,headers,payload:JSON.stringify(payload)});}
async function load(app:App,id:string):Promise<Project>{return (await app.inject(`/api/projects/${id}`)).json();}
async function save(app:App,p:Project,artifact:'flow'|'wireframes'|'features'|'prd',value:unknown){const result=await request(app,'PUT',`/api/projects/${p.id}/artifacts/${artifact}`,{expectedRevision:p.artifactRevisions[artifact],flowVersionId:p.selectedFlowVersionId,value});expect(result.statusCode,result.body).toBe(200);return result.json<Project>();}
async function seed(app:App,visuals=true){let p=(await request(app,'POST','/api/projects',{name:'AI 목적지'})).json<Project>();if(visuals){p=await save(app,p,'flow',oldFlow);p=await save(app,p,'wireframes',[{id:'old-screen',revision:0,flowNodeId:'old-page',flowRevision:p.artifactRevisions.flow,name:'보존할 화면',device:'desktop',elements:[]}]);}return p;}
async function start(app:App,p:Project,mode?:FlowGenerationMode,prompt='새 흐름을 생성해 주세요'){const result=await request(app,'POST',`/api/projects/${p.id}/ai/runs`,{artifact:'flow',prompt,flowVersionId:p.selectedFlowVersionId,flowGenerationMode:mode});expect(result.statusCode,result.body).toBe(202);return result.json<AiRun>();}
async function done(app:App,id:string){for(let i=0;i<100;i++){const run=(await app.inject(`/api/ai/runs/${id}`)).json<AiRun>();if(!['queued','running'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Fixture did not finish');}
async function proposal(app:App,p:Project,run:AiRun):Promise<Proposal>{expect(run.status,run.error||'').toBe('succeeded');return (await app.inject(`/api/projects/${p.id}/activity`)).json().proposals.find((item:Proposal)=>item.id===run.proposalId);}
async function resolve(app:App,draft:Proposal,action='approve',commandId:string=crypto.randomUUID()){return request(app,'POST',`/api/proposals/${draft.id}/resolve`,{action,commandId});}
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('AI flow generation destinations',()=>{
  it('creates a new version only on approval, allows removed source pages, and preserves source bytes',async()=>{
    let context:Project|undefined;
    const app=await make(async({prompt})=>{context=JSON.parse(prompt).project;return {summary:'수정된 사용자 여정',document:newFlow};});const p=await seed(app);const source=structuredClone(p.flowGroups[0].versions[0]);
    const run=await done(app,(await start(app,p,'new-version')).id);expect(run.flowGenerationMode).toBe('new-version');const draft=await proposal(app,p,run);
    expect(context!.flow).toEqual(oldFlow);expect(context!.wireframes).toEqual([]);expect(await load(app,p.id)).toEqual(p);expect(draft.flowGenerationMode).toBe('new-version');
    const applied=await resolve(app,draft);expect(applied.statusCode,applied.body).toBe(200);const result=applied.json<{project:Project;proposal:Proposal}>();
    expect(result.project.flowGroups).toHaveLength(1);expect(count(result.project)).toBe(2);expect(result.project.flowGroups[0].versions[0]).toEqual(source);expect(result.project.flow).toEqual(newFlow);expect(result.project.wireframes).toEqual([]);
    expect(result.project.selectedFlowVersionId).not.toBe(p.selectedFlowVersionId);expect(result.proposal.resultFlowVersionId).toBe(result.project.selectedFlowVersionId);expect(result.proposal.status).toBe('applied');
    const replay=await resolve(app,draft,'approve','another-command');expect(replay.statusCode).toBe(200);expect(replay.json().project).toEqual(result.project);
  });

  it('uses empty visual context for a new group while preserving requirements, features and all origin data',async()=>{
    let payload:any;
    const app=await make(async({prompt})=>{payload=JSON.parse(prompt);return {summary:'독립 결제 여정',document:newFlow};});let p=await seed(app);
    p=await save(app,p,'prd',[{id:'req',revision:0,section:'overview',title:'목표',content:'<p>결제 개선</p>'}]);
    p=await save(app,p,'features',[{id:'feature',revision:0,parentId:null,kind:'requirement',title:'결제',description:'',priority:'high',status:'planned',roles:[],acceptanceCriteria:[],prdIds:['req'],favorite:false}]);
    const original=structuredClone(p);const draft=await proposal(app,p,await done(app,(await start(app,p,'new-group')).id));
    expect(payload.flowGenerationMode).toBe('new-group');expect(payload.project.flow).toEqual({nodes:[],edges:[],sections:[]});expect(payload.project.wireframes).toEqual([]);expect(payload.project.flowGroups).toBeUndefined();expect(payload.project.prd).toEqual(p.prd);expect(payload.project.features).toEqual(p.features);
    const result=(await resolve(app,draft)).json<{project:Project;proposal:Proposal}>();expect(result.project.flowGroups).toHaveLength(2);expect(result.project.flowGroups[0]).toEqual(original.flowGroups[0]);expect(result.project.flowGroups[1].id).not.toBe(original.flowGroups[0].id);expect(result.project.flowGroups[1].versions[0].number).toBe(1);expect(result.project.wireframes).toEqual([]);expect(result.project.prd).toEqual(original.prd);
  });

  it.each(['new-version','new-group'] as const)('requires approval for identical empty graph in %s mode',async mode=>{
    const app=await make(async({prompt})=>({summary:'같은 구조의 독립 결과',document:JSON.parse(prompt).project.flow}));const p=await seed(app,false);const draft=await proposal(app,p,await done(app,(await start(app,p,mode)).id));
    expect(draft.changes).toHaveLength(1);expect(draft.status).toBe('pending');expect(await load(app,p.id)).toEqual(p);
    const applied=(await resolve(app,draft)).json<{project:Project}>();expect(count(applied.project)).toBe(2);expect(applied.project.selectedFlowVersionId).not.toBe(p.selectedFlowVersionId);
  });

  it('leaves no empty destination after rejection, provider failure, or cancelled late output',async()=>{
    let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const waiting=new Promise<void>(resolve=>{entered=resolve;});
    const app=await make(async({prompt})=>{const {request}=JSON.parse(prompt);if(request==='fail')return {summary:'invalid',document:{nodes:'invalid'}};if(request==='cancel'){entered();await gate;}return {summary:'생성 결과',document:newFlow};});const p=await seed(app);
    const rejected=await proposal(app,p,await done(app,(await start(app,p,'new-version')).id));expect((await resolve(app,rejected,'reject')).statusCode).toBe(200);expect(await load(app,p.id)).toEqual(p);
    const failed=await done(app,(await start(app,p,'new-group','fail')).id);expect(failed.status).toBe('failed');expect(await load(app,p.id)).toEqual(p);
    const cancelled=await start(app,p,'new-group','cancel');await waiting;await request(app,'POST',`/api/ai/runs/${cancelled.id}/cancel`,{});release();await new Promise(resolve=>setTimeout(resolve,20));expect((await done(app,cancelled.id)).status).toBe('cancelled');expect(await load(app,p.id)).toEqual(p);expect((await app.inject(`/api/projects/${p.id}/activity`)).json().proposals).toHaveLength(1);
  });

  it('keeps wrong-context proposals pending, then approves from the origin, but rejects changed source flow',async()=>{
    const app=await make();let p=await seed(app);const origin=p.selectedFlowVersionId;const draft=await proposal(app,p,await done(app,(await start(app,p,'new-version')).id));
    p=(await request(app,'POST',`/api/projects/${p.id}/flow-groups/${p.flowGroups[0].id}/versions`,{expectedRevision:p.revision,sourceVersionId:origin})).json();const wrong=await resolve(app,draft);expect(wrong.statusCode).toBe(409);expect(wrong.json().code).toBe('FLOW_CONTEXT_CONFLICT');expect(count(await load(app,p.id))).toBe(2);expect((await app.inject(`/api/projects/${p.id}/activity`)).json().proposals[0].status).toBe('pending');
    p=(await request(app,'POST',`/api/projects/${p.id}/flow-versions/${origin}/select`,{expectedRevision:p.revision})).json();const result=await resolve(app,draft);expect(result.statusCode).toBe(200);p=result.json().project;expect(count(p)).toBe(3);
    const stale=await proposal(app,p,await done(app,(await start(app,p,'new-group')).id));p=await save(app,p,'flow',{...p.flow,nodes:p.flow.nodes.map(item=>({...item,label:'새 수동 수정'}))});const before=structuredClone(p);const conflict=await resolve(app,stale);expect(conflict.statusCode).toBe(409);expect(conflict.json().code).toBe('REVISION_CONFLICT');expect(await load(app,p.id)).toEqual(before);
  });

  it('validates feature references again at approval and rolls back destination creation when references vanished',async()=>{
    const app=await make(async()=>({summary:'참조하는 새 여정',document:{...newFlow,nodes:[{...node('new-page'),featureIds:['feature']}]}}));let p=await seed(app);
    p=await save(app,p,'features',[{id:'feature',revision:0,parentId:null,kind:'requirement',title:'일시 기능',description:'',priority:'medium',status:'planned',roles:[],acceptanceCriteria:[],prdIds:[],favorite:false}]);const draft=await proposal(app,p,await done(app,(await start(app,p,'new-group')).id));p=await save(app,p,'features',[]);
    const result=await resolve(app,draft);expect(result.statusCode).toBe(400);expect(result.json().code).toBe('INVALID_REFERENCE');expect(await load(app,p.id)).toEqual(p);expect((await app.inject(`/api/projects/${p.id}/activity`)).json().proposals[0].status).toBe('pending');
  });

  it('persists pending mode and applied result across restart, with duplicate approvals creating no extra versions',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'planit-generation-'));directories.push(directory);const dbPath=path.join(directory,'db.sqlite');let app=await make(undefined,dbPath);const p=await seed(app);const draft=await proposal(app,p,await done(app,(await start(app,p,'new-group')).id));await app.close();apps.splice(apps.indexOf(app),1);
    app=await make(undefined,dbPath);const activity=(await app.inject(`/api/projects/${p.id}/activity`)).json();expect(activity.runs[0].flowGenerationMode).toBe('new-group');expect(activity.proposals[0].flowGenerationMode).toBe('new-group');const command=crypto.randomUUID();const applied=(await resolve(app,draft,'approve',command)).json();await app.close();apps.splice(apps.indexOf(app),1);
    app=await make(undefined,dbPath);expect(await load(app,p.id)).toEqual(applied.project);const replay=await resolve(app,draft,'approve',command);expect(replay.statusCode).toBe(200);expect(replay.json().project).toEqual(applied.project);expect(replay.json().proposal.resultFlowVersionId).toBe(applied.project.selectedFlowVersionId);
  });

  it('rejects non-flow modes and selected-item new modes while omitted mode retains edit behavior',async()=>{
    const app=await make(async({prompt})=>{const {project}=JSON.parse(prompt);return {summary:'현재 버전 수정',document:{...project.flow,nodes:project.flow.nodes.map((item:object)=>({...item,label:'편집됨'}))}};});const p=await seed(app);
    expect((await request(app,'POST',`/api/projects/${p.id}/ai/runs`,{artifact:'prd',prompt:'잘못된 모드',flowGenerationMode:'edit'})).json().code).toBe('INVALID_FLOW_MODE');
    expect((await request(app,'POST',`/api/projects/${p.id}/ai/runs`,{artifact:'flow',prompt:'선택 새 버전',flowGenerationMode:'new-version',entityIds:['old-page'],flowVersionId:p.selectedFlowVersionId})).json().code).toBe('INVALID_SELECTION');
    const run=await done(app,(await start(app,p)).id);expect(run.flowGenerationMode).toBe('edit');const draft=await proposal(app,p,run);const result=(await resolve(app,draft)).json();expect(result.project.selectedFlowVersionId).toBe(p.selectedFlowVersionId);expect(count(result.project)).toBe(1);expect(result.project.wireframes).toEqual(p.wireframes);expect(result.proposal.resultFlowVersionId).toBeUndefined();
  });
});
