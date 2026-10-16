import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createApp } from './app.js';
import { WorkspaceStore } from './store.js';
import { newProject } from './documents.js';
import type { AIProvider, GenerationInput } from './provider.js';
import type { AiRun, Project, Proposal } from '../shared/schema.js';

type App = Awaited<ReturnType<typeof createApp>>;
const apps: App[] = [], directories: string[] = [];
const headers = {'x-requested-with':'ProjectManager','content-type':'application/json'};
const item = (id:string,title=id) => ({id,revision:0,section:'overview' as const,title,content:`<p>${title} 내용</p>`});
const provider = (generate:AIProvider['generate']):AIProvider => ({model:'fixture-model',configured:true,generate});
const makeApp = async (options:Parameters<typeof createApp>[0]={}) => {const app=await createApp(options);apps.push(app);return app;};
async function request(app:App, method:'POST'|'PUT'|'PATCH', url:string, payload:unknown) {return app.inject({method,url,payload:JSON.stringify(payload),headers});}
async function create(app:App,name='테스트 프로젝트'):Promise<Project> {return (await request(app,'POST','/api/projects',{name})).json();}
async function save(app:App,p:Project,artifact:'prd'|'features'|'flow'|'wireframes',value:unknown) {return request(app,'PUT',`/api/projects/${p.id}/artifacts/${artifact}`,{expectedRevision:p.artifactRevisions[artifact],value,flowVersionId:p.selectedFlowVersionId});}
async function run(app:App,p:Project,artifact='prd',entityIds?:string[]):Promise<AiRun> {const response=await request(app,'POST',`/api/projects/${p.id}/ai/runs`,{artifact,prompt:'개선해 주세요',entityIds,flowVersionId:p.selectedFlowVersionId});expect(response.statusCode).toBe(202);return response.json();}
async function completed(app:App,id:string):Promise<AiRun> {for(let i=0;i<100;i++){const r=(await app.inject(`/api/ai/runs/${id}`)).json<AiRun>();if(!['queued','running'].includes(r.status))return r;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Fixture job did not complete');}
async function proposal(app:App,p:Project,r:AiRun):Promise<Proposal> {return (await app.inject(`/api/projects/${p.id}/activity`)).json().proposals.find((proposal:Proposal)=>proposal.id===r.proposalId);}
async function resolve(app:App,p:Proposal,action='approve',commandId=crypto.randomUUID(),changeIds?:string[]) {return request(app,'POST',`/api/proposals/${p.id}/resolve`,{action,commandId,changeIds});}

afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('persistent documents and transaction boundaries',()=>{
  it('persists an approved AI draft across restart and idempotent approve never duplicates changes',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'planit-domain-'));directories.push(directory);const dbPath=path.join(directory,'test.sqlite');
    const app=await makeApp({dbPath,provider:provider(async()=>({summary:'개요 추가',document:[item('overview')]}))});
    const p=await create(app);const started=await run(app,p);const done=await completed(app,started.id);expect(done.status).toBe('succeeded');
    expect((await app.inject(`/api/projects/${p.id}`)).json().prd).toEqual([]);
    const draft=await proposal(app,p,done);const command=crypto.randomUUID();
    const first=await resolve(app,draft,'approve',command);expect(first.statusCode).toBe(200);expect(first.json().project.prd).toHaveLength(1);
    const again=await resolve(app,draft,'approve',command);expect(again.json().project.revision).toBe(first.json().project.revision);
    const againNew=await resolve(app,draft);expect(againNew.json().project.revision).toBe(first.json().project.revision);
    await app.close();apps.splice(apps.indexOf(app),1);
    const reopened=await makeApp({dbPath,provider:provider(async()=>({}))});const loaded=(await reopened.inject(`/api/projects/${p.id}`)).json<Project>();expect(loaded.prd[0].title).toBe('overview');expect(loaded.revision).toBe(1);
    expect((await reopened.inject(`/api/projects/${p.id}/revisions`)).json()).toHaveLength(2);
  });

  it('preserves unrelated manual edits but rejects stale changes to the same entity',async()=>{
    const app=await makeApp({provider:provider(async({prompt})=>{const {project}=JSON.parse(prompt);return {summary:'A 개선',document:project.prd.map((entry:{id:string})=>entry.id==='a'?{...entry,title:'AI A'}:entry)};})});
    let p=await create(app);p=(await save(app,p,'prd',[item('a'),item('b')])).json();
    const first=await completed(app,(await run(app,p)).id);const firstDraft=await proposal(app,p,first);
    p=(await save(app,p,'prd',p.prd.map(entry=>entry.id==='b'?{...entry,title:'수동 B'}:entry))).json();
    const applied=await resolve(app,firstDraft);expect(applied.statusCode).toBe(200);p=applied.json().project;expect(p.prd.find(entry=>entry.id==='b')?.title).toBe('수동 B');
    p=(await save(app,p,'prd',p.prd.map(entry=>entry.id==='a'?{...entry,title:'A 초기화'}:entry))).json();
    const second=await completed(app,(await run(app,p)).id);const secondDraft=await proposal(app,p,second);
    p=(await save(app,p,'prd',p.prd.map(entry=>entry.id==='a'?{...entry,title:'최신 수동 A'}:entry))).json();
    const conflict=await resolve(app,secondDraft);expect(conflict.statusCode).toBe(409);expect(conflict.json().code).toBe('REVISION_CONFLICT');
    expect((await app.inject(`/api/projects/${p.id}`)).json().prd.find((entry:{id:string})=>entry.id==='a').title).toBe('최신 수동 A');
    expect((await resolve(app,secondDraft,'reject')).statusCode).toBe(200);
  });

  it('rejects dangling references and dependent partial approvals atomically',async()=>{
    const features=[{id:'r',revision:0,parentId:null,kind:'requirement',title:'요구사항',description:'',priority:'medium',status:'backlog',roles:[],acceptanceCriteria:[],prdIds:[],favorite:false},{id:'f',revision:0,parentId:'r',kind:'feature',title:'기능',description:'',priority:'medium',status:'backlog',roles:[],acceptanceCriteria:[],prdIds:[],favorite:false}];
    const app=await makeApp({provider:provider(async()=>({summary:'기능 추가',document:features}))});let p=await create(app);
    const done=await completed(app,(await run(app,p,'features')).id);const draft=await proposal(app,p,done);const child=draft.changes.find(change=>change.entityId==='f')!;
    expect((await resolve(app,draft,'approve',crypto.randomUUID(),[child.id])).statusCode).toBe(400);expect((await app.inject(`/api/projects/${p.id}`)).json().features).toHaveLength(0);
    const applied=await resolve(app,draft);expect(applied.statusCode).toBe(200);p=applied.json().project;
    expect((await save(app,p,'features',p.features.filter(feature=>feature.id!=='r'))).statusCode).toBe(400);
    expect((await app.inject(`/api/projects/${p.id}`)).json().features).toHaveLength(2);
  });

  it('cancels an active job and discards a late provider result',async()=>{
    let release!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
    const app=await makeApp({provider:provider(async({onDelta})=>{entered();await gate;onDelta('late');return {summary:'늦은 응답',document:[item('late')]};})});const p=await create(app);const job=await run(app,p);await started;
    expect((await request(app,'POST',`/api/ai/runs/${job.id}/cancel`,{})).json().status).toBe('cancelled');release();await new Promise(resolve=>setTimeout(resolve,20));
    const activity=(await app.inject(`/api/projects/${p.id}/activity`)).json();expect(activity.proposals).toHaveLength(0);expect(activity.runs[0].status).toBe('cancelled');expect((await app.inject(`/api/projects/${p.id}`)).json().prd).toHaveLength(0);
  });

  it('preserves unselected stale screen content and version during partial regeneration',async()=>{
    const app=await makeApp({provider:provider(async({prompt})=>{const {project}=JSON.parse(prompt);return {summary:'첫 화면 수정',document:[{...project.wireframes[0],name:'첫 화면 수정'}]};})});let p=await create(app);
    p=(await save(app,p,'flow',{nodes:[{id:'page1',type:'page',label:'1',description:'',position:{x:0,y:0},featureIds:[],sectionId:null},{id:'page2',type:'page',label:'2',description:'',position:{x:300,y:0},featureIds:[],sectionId:null}],edges:[],sections:[]})).json();
    p=(await save(app,p,'wireframes',[{id:'s1',revision:0,flowNodeId:'page1',flowRevision:p.artifactRevisions.flow,name:'첫 화면',device:'desktop',elements:[]},{id:'s2',revision:0,flowNodeId:'page2',flowRevision:p.artifactRevisions.flow,name:'둘째 화면',device:'desktop',elements:[]}])).json();
    const second=structuredClone(p.wireframes[1]);p=(await save(app,p,'flow',{...p.flow,nodes:p.flow.nodes.map(node=>({...node,label:node.label+' 변경'}))})).json();
    const done=await completed(app,(await run(app,p,'wireframes',['s1'])).id);expect(done.status).toBe('succeeded');const draft=await proposal(app,p,done);expect(draft.changes).toHaveLength(1);
    p=(await resolve(app,draft)).json().project;expect(p.wireframes[1]).toEqual(second);expect(p.wireframes[0].flowRevision).toBe(p.artifactRevisions.flow);expect(p.wireframes[1].flowRevision).not.toBe(p.artifactRevisions.flow);
    const copy=(await request(app,'POST',`/api/projects/${p.id}/duplicate`,{})).json<Project>();expect(copy.wireframes[0].flowRevision).toBe(copy.artifactRevisions.flow);expect(copy.wireframes[1].flowRevision).not.toBe(copy.artifactRevisions.flow);
  });

  it('restores historical revisions with fresh revision numbers and preserves snapshot coherence',async()=>{
    const app=await makeApp();let p=await create(app);p=(await save(app,p,'prd',[item('stable')])).json();const snapshot=(await app.inject(`/api/projects/${p.id}/revisions`)).json()[0];
    p=(await save(app,p,'prd',[{...p.prd[0],title:'편집1'}])).json();p=(await save(app,p,'prd',[])).json();
    const restored=(await request(app,'POST',`/api/projects/${p.id}/revisions/${snapshot.id}/restore`,{expectedRevision:p.revision})).json<Project>();expect(restored.prd[0].title).toBe('stable');expect(restored.prd[0].revision).toBeGreaterThan(2);expect(restored.revision).toBeGreaterThan(p.revision);
    expect((await app.inject(`/api/projects/${p.id}/revisions`)).json()).toHaveLength(5);
  });

  it('rejects unsafe origins and untrusted HTML, exports actual XLSX and isolates restored ids',async()=>{
    const app=await makeApp();expect((await app.inject({method:'POST',url:'/api/projects',headers:{...headers,origin:'https://evil.example'},payload:{name:'bad'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/projects',headers:{'content-type':'application/json'},payload:{name:'bad'}})).statusCode).toBe(403);
    let p=await create(app,'한국어 테스트');p=(await save(app,p,'prd',[{...item('safe'),content:'<p>안전<script>alert(1)</script><a href="javascript:alert(1)">링크</a></p>'}])).json();expect(p.prd[0].content).not.toMatch(/script|javascript/);
    const backup=(await app.inject(`/api/projects/${p.id}/backup`)).json();expect(JSON.stringify(backup)).not.toContain('GROQ_API_KEY');const restored=(await request(app,'POST','/api/backups/restore',backup)).json<Project>();expect(restored.id).not.toBe(p.id);expect(restored.prd[0].id).not.toBe(p.prd[0].id);
    const binary=await app.inject(`/api/projects/${p.id}/export?format=xlsx`);expect(binary.statusCode).toBe(200);const book=new ExcelJS.Workbook();await book.xlsx.load(binary.rawPayload as never);expect(book.getWorksheet('PRD')?.getCell('C2').text).toContain('안전');
    const md=await app.inject(`/api/projects/${p.id}/export?format=markdown`);expect(md.body).toContain('# 한국어 테스트');
  });

  it('marks interrupted persisted jobs failed after restart without retrying',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'planit-restart-'));directories.push(directory);const filename=path.join(directory,'workspace.sqlite');const first=new WorkspaceStore(filename);const p=first.insert(newProject('restart'));
    first.putRun({id:'interrupted',projectId:p.id,artifact:'prd',prompt:'private user prompt',status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),output:'draft',error:null,proposalId:null,model:'fixture',usage:null});first.close();
    const second=new WorkspaceStore(filename);expect(second.run('interrupted').status).toBe('failed');expect(second.project(p.id).prd).toHaveLength(0);second.close();
  });
});
