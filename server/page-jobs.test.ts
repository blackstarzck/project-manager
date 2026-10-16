import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { WorkspaceStore } from './store.js';
import type { AIProvider } from './provider.js';
import { newProject, selectedVersion, selectedWireframeVersion } from './documents.js';
import { linkNavigation } from '../shared/wireframe-navigation.js';
import type { AiRun, Project, Proposal, WireScreen } from '../shared/schema.js';

type App=Awaited<ReturnType<typeof createApp>>;
const apps:App[]=[],directories:string[]=[];
const headers={'x-requested-with':'ProjectManager','content-type':'application/json'};
const node=(id:string)=>({id,type:'page',label:id,description:'',position:{x:0,y:0},featureIds:[],sectionId:null});
const screen=(id:string):WireScreen=>({id:`screen-${id}`,name:`화면 ${id}`,flowNodeId:id,flowRevision:1,revision:0,device:'desktop',elements:[{id:`header-${id}`,type:'header',text:`메뉴 ${id}`,targetScreenId:null,children:[{id:`nav-${id}`,type:'nav',text:'홈',targetScreenId:null}]},{id:`body-${id}`,type:'body',text:`수동 본문 ${id}`,targetScreenId:null}]});
const output=(context:any)=>({summary:`${context.pageTask.label} 완료`,document:context.pageTask.screenIds.length?context.project.wireframes.filter((screen:WireScreen)=>context.pageTask.screenIds.includes(screen.id)).map((screen:WireScreen)=>({...screen,name:`생성 ${context.pageTask.label}`})):[screen(context.pageTask.pageId)]});
async function make(generate:AIProvider['generate'],dbPath?:string){const a=await createApp({provider:{configured:true,model:'fixture',generate},dbPath});apps.push(a);return a;}
async function send(a:App,method:'POST'|'PUT',url:string,payload:unknown){return a.inject({method,url,headers,payload:JSON.stringify(payload)});}
async function save(a:App,p:Project,value:WireScreen[]){const r=await send(a,'PUT',`/api/projects/${p.id}/artifacts/wireframes`,{value,flowVersionId:p.selectedFlowVersionId,wireframeVersionId:p.selectedWireframeVersionId,expectedRevision:p.artifactRevisions.wireframes});expect(r.statusCode,r.body).toBe(200);return r.json<Project>();}
async function seed(a:App,existing=true){let p=(await send(a,'POST','/api/projects',{name:'페이지별 결과'})).json<Project>();p=(await send(a,'PUT',`/api/projects/${p.id}/artifacts/flow`,{value:{nodes:['A','B','C','D'].map(node),edges:[],sections:[]},flowVersionId:p.selectedFlowVersionId,expectedRevision:0})).json();return existing?save(a,p,['A','B','C','D'].map(screen)):p;}
async function load(a:App,p:Project){return (await a.inject(`/api/projects/${p.id}`)).json<Project>();}
async function start(a:App,p:Project,mode='regenerate',entityIds=['screen-A','screen-B','screen-C']){const r=await send(a,'POST',`/api/projects/${p.id}/ai/runs`,{artifact:'wireframes',prompt:'선택한 화면을 개선해 주세요',wireframeGenerationMode:mode,flowVersionId:p.selectedFlowVersionId,wireframeVersionId:p.selectedWireframeVersionId,entityIds});expect(r.statusCode,r.body).toBe(202);return r.json<AiRun>();}
async function readRun(a:App,id:string){return (await a.inject(`/api/ai/runs/${id}`)).json<AiRun>();}
async function done(a:App,id:string){for(let n=0;n<300;n++){const run=await readRun(a,id);if(!['queued','running'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Fixture timeout');}
async function getProposal(a:App,p:Project,id:string){return (await a.inject(`/api/projects/${p.id}/activity`)).json().proposals.find((proposal:Proposal)=>proposal.id===id) as Proposal;}
async function retry(a:App,id:string,commandId:string=crypto.randomUUID(),pageTaskIds?:string[]){return send(a,'POST',`/api/ai/runs/${id}/retry-pages`,{commandId,pageTaskIds});}
async function approve(a:App,id:string,allowPartial=false,commandId:string=crypto.randomUUID()){return send(a,'POST',`/api/proposals/${id}/resolve`,{action:'approve',allowPartial,commandId});}
afterEach(async()=>{for(const a of apps.splice(0))await a.close();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});

describe('page-level generation jobs',()=>{
  it('persists partial results, retries only failed pages once per command and replaces the stale proposal',async()=>{
    const calls:{page:string;attempt:number}[]=[];let active=0,maxActive=0;const a=await make(async({prompt,onDelta})=>{const c=JSON.parse(prompt);calls.push({page:c.pageTask.pageId,attempt:c.pageTask.attempt});maxActive=Math.max(maxActive,++active);await new Promise(resolve=>setTimeout(resolve,3));active--;if(c.pageTask.pageId==='B'&&c.pageTask.attempt===1)throw Error('Fixture failure');const result=output(c);onDelta(JSON.stringify(result));return result;});const p=await seed(a);const source=selectedWireframeVersion(p);let run=await done(a,(await start(a,p)).id);
    expect(run.status).toBe('succeeded');expect(run.pageSummary).toEqual({total:3,succeeded:2,failed:1,cancelled:0});expect(run.pageTasks?.map(task=>task.attempt)).toEqual([1,1,1]);expect(maxActive).toBe(1);expect(await load(a,p)).toEqual(p);const firstProposal=await getProposal(a,p,run.proposalId!);expect(firstProposal.partial).toBe(true);expect((await approve(a,firstProposal.id)).json().code).toBe('PARTIAL_APPROVAL_REQUIRED');const retained=structuredClone(run.pageTasks!.filter(task=>task.status==='succeeded'));
    const restarted=await retry(a,run.id,'retry-command');expect(restarted.statusCode).toBe(202);expect((await retry(a,run.id,'retry-command')).statusCode).toBe(202);expect((await approve(a,firstProposal.id,true)).json().code).toBe('PROPOSAL_CANCELLED');run=await done(a,run.id);
    expect(calls).toEqual([{page:'A',attempt:1},{page:'B',attempt:1},{page:'C',attempt:1},{page:'B',attempt:2}]);expect(run.pageTasks!.filter(task=>task.pageId!=='B')).toEqual(retained);expect(run.pageSummary?.succeeded).toBe(3);expect(run.proposalId).not.toBe(firstProposal.id);const proposal=await getProposal(a,p,run.proposalId!);expect(proposal.partial).toBe(false);
    const applied=await approve(a,proposal.id);expect(applied.statusCode,applied.body).toBe(200);const result=applied.json().project as Project;expect(selectedVersion(result).wireframeVersions).toHaveLength(2);expect(selectedVersion(result).wireframeVersions[0]).toEqual(source);expect(result.wireframes[3]).toEqual(p.wireframes[3]);expect((await approve(a,proposal.id)).json().project).toEqual(result);expect((await retry(a,run.id)).json().code).toBe('RUN_ALREADY_APPLIED');
  });

  it('requires explicit partial approval, preserves failed/unselected screens and allows no duplicate destination',async()=>{
    const a=await make(async({prompt})=>{const c=JSON.parse(prompt);if(c.pageTask.pageId==='B')throw Error('Fixture failure');return output(c);});const p=await seed(a),run=await done(a,(await start(a,p)).id);const result=await approve(a,run.proposalId!,true,'partial-command');expect(result.statusCode,result.body).toBe(200);const next=result.json().project as Project;expect(next.wireframes[0].name).toBe('생성 A');expect(next.wireframes[1]).toEqual(p.wireframes[1]);expect(next.wireframes[2].name).toBe('생성 C');expect(next.wireframes[3]).toEqual(p.wireframes[3]);expect((await approve(a,run.proposalId!,true,'partial-command')).json().project).toEqual(next);expect((await retry(a,run.id)).json().code).toBe('RUN_ALREADY_APPLIED');
  });

  it('cancels without an automatic proposal, preserves completed pages and explicitly prepares a partial review',async()=>{
    let release:()=>void=()=>{},waiting=false;const a=await make(async({prompt})=>{const c=JSON.parse(prompt);if(c.pageTask.pageId==='B'){waiting=true;await new Promise<void>(resolve=>{release=resolve;});}return output(c);});const p=await seed(a);const started=await start(a,p);for(let n=0;n<100&&!waiting;n++)await new Promise(resolve=>setTimeout(resolve,5));expect(waiting).toBe(true);const cancelled=(await send(a,'POST',`/api/ai/runs/${started.id}/cancel`,{})).json<AiRun>();expect(cancelled.pageSummary).toEqual({total:3,succeeded:1,failed:0,cancelled:2});expect(cancelled.proposalId).toBeNull();release();await new Promise(resolve=>setTimeout(resolve,10));expect((await readRun(a,started.id)).pageTasks![1].screens).toBeNull();
    const prepared=await send(a,'POST',`/api/ai/runs/${started.id}/prepare-proposal`,{commandId:'explicit-review'});expect(prepared.statusCode,prepared.body).toBe(200);const run=prepared.json<AiRun>();expect(run.proposalId).toBeTruthy();expect((await send(a,'POST',`/api/ai/runs/${started.id}/prepare-proposal`,{commandId:'explicit-review'})).json().proposalId).toBe(run.proposalId);expect(await load(a,p)).toEqual(p);expect((await approve(a,run.proposalId!,true)).statusCode).toBe(200);
  });

  it('keeps completed results across restart and cancels interrupted tasks without automatic paid retry',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'planit-page-jobs-'));directories.push(directory);const file=path.join(directory,'workspace.sqlite');let a=await make(async({prompt})=>{const c=JSON.parse(prompt);if(c.pageTask.pageId==='B')throw Error('Fixture');return output(c);},file);const p=await seed(a);const run=await done(a,(await start(a,p)).id);await a.close();apps.splice(apps.indexOf(a),1);const store=new WorkspaceStore(file);store.putRun({...store.run(run.id),status:'running',proposalId:null,pageTasks:run.pageTasks!.map(task=>task.pageId==='B'?{...task,status:'running'}:task)});store.close();let paidCalls=0;a=await make(async({prompt})=>{paidCalls++;return output(JSON.parse(prompt));},file);const restored=await readRun(a,run.id);expect(paidCalls).toBe(0);expect(restored.status).toBe('failed');expect(restored.pageTasks!.filter(task=>task.status==='succeeded')).toEqual(run.pageTasks!.filter(task=>task.status==='succeeded'));expect(restored.pageTasks![1].status).toBe('cancelled');expect((await retry(a,run.id)).statusCode).toBe(202);const finished=await done(a,run.id);expect(paidCalls).toBe(1);expect(finished.pageSummary?.succeeded).toBe(3);expect(await load(a,p)).toEqual(p);
  });

  it('checks source context/revisions before invalidating proposals or spending retries',async()=>{
    let calls=0;const a=await make(async({prompt})=>{calls++;const c=JSON.parse(prompt);if(c.pageTask.pageId==='B')throw Error('Fixture');return output(c);});let p=await seed(a);const original=p,run=await done(a,(await start(a,p)).id),proposal=await getProposal(a,p,run.proposalId!);const path=`/api/projects/${p.id}/flow-versions/${p.selectedFlowVersionId}/wireframe-versions`;p=(await send(a,'POST',path,{expectedRevision:p.revision,sourceWireframeVersionId:p.selectedWireframeVersionId})).json();expect((await retry(a,run.id)).json().code).toBe('WIREFRAME_CONTEXT_CONFLICT');expect(await readRun(a,run.id)).toEqual(run);expect(await getProposal(a,p,proposal.id)).toEqual(proposal);expect(calls).toBe(3);
    p=(await send(a,'POST',`${path}/${original.selectedWireframeVersionId}/select`,{expectedRevision:p.revision})).json();p=await save(a,p,p.wireframes.map(screen=>screen.id==='screen-D'?{...screen,name:'다른 수정'}:screen));expect((await retry(a,run.id)).json().code).toBe('REVISION_CONFLICT');expect(await readRun(a,run.id)).toEqual(run);expect(await getProposal(a,p,proposal.id)).toEqual(proposal);expect(calls).toBe(3);
  });

  it('bounds retries to three attempts and rejects future dangling page links without losing other successes',async()=>{
    const calls:string[]=[];const a=await make(async({prompt})=>{const c=JSON.parse(prompt);calls.push(c.pageTask.pageId);if(c.pageTask.pageId==='B')return {summary:'불완전 연결',document:[{...screen('B'),elements:[{id:'future-link',type:'button',text:'미생성 페이지',targetScreenId:'not-generated',action:'navigate'}]}]};return output(c);});const p=await seed(a);let run=await done(a,(await start(a,p)).id);expect(run.pageSummary?.succeeded).toBe(2);expect(run.pageTasks![1].status).toBe('failed');for(let attempt=2;attempt<=3;attempt++){expect((await retry(a,run.id)).statusCode).toBe(202);run=await done(a,run.id);expect(run.pageTasks![1].attempt).toBe(attempt);}expect((await retry(a,run.id)).json().code).toBe('INVALID_RETRY_SELECTION');expect(calls).toEqual(['A','B','C','B','B']);expect((await approve(a,run.proposalId!,true)).statusCode).toBe(200);
  });

  it('atomically prevents approve/retry races from creating two destinations',async()=>{
    const a=await make(async({prompt})=>{const c=JSON.parse(prompt);if(c.pageTask.pageId==='B'&&c.pageTask.attempt===1)throw Error('Fixture');return output(c);});const p=await seed(a);const run=await done(a,(await start(a,p)).id);const [retryResult,approval]=await Promise.all([retry(a,run.id),approve(a,run.proposalId!,true)]);if(retryResult.statusCode===202){expect(approval.json().code).toBe('PROPOSAL_CANCELLED');const finished=await done(a,run.id);expect((await approve(a,finished.proposalId!)).statusCode).toBe(200);}else{expect(retryResult.json().code).toBe('RUN_ALREADY_APPLIED');expect(approval.statusCode).toBe(200);}expect(selectedVersion(await load(a,p)).wireframeVersions).toHaveLength(2);
  });

  it('protects failed linked followers, synchronizes unselected followers and preserves source bindings',async()=>{
    const a=await make(async({prompt})=>{const c=JSON.parse(prompt);if(c.pageTask.pageId==='B')throw Error('Fixture');const result=output(c);result.document=result.document.map((screen:WireScreen)=>({...screen,elements:screen.elements.map(element=>element.type==='header'?{...element,text:'성공한 새 공통 헤더'}:element)}));return result;});let p=await seed(a);let sequence=0;p=await save(a,p,linkNavigation(p.wireframes,'screen-A',['screen-B','screen-D'],['header'],()=>`link-${++sequence}`));const source=structuredClone(selectedWireframeVersion(p));const run=await done(a,(await start(a,p)).id),proposal=await getProposal(a,p,run.proposalId!);expect(proposal.partial).toBe(true);expect(proposal.navigationDetachedScreenIds).toEqual(['screen-B']);const candidate=proposal.changes[0].after as WireScreen[];expect(candidate[1].elements).toEqual(p.wireframes[1].elements);expect(candidate[1].navigationSync).toBeUndefined();expect(candidate[3].elements[0].text).toBe('성공한 새 공통 헤더');expect(candidate[3].elements[1]).toEqual(p.wireframes[3].elements[1]);expect((await approve(a,proposal.id)).json().code).toBe('PARTIAL_APPROVAL_REQUIRED');const result=(await approve(a,proposal.id,true)).json().project as Project;expect(selectedVersion(result).wireframeVersions[0]).toEqual(source);expect(result.wireframes[1].elements).toEqual(p.wireframes[1].elements);
  });

  it('materializes manual shared navigation and remaps bindings through backup/import across all histories',async()=>{
    const a=await make(async({prompt})=>output(JSON.parse(prompt)));let p=await seed(a);let sequence=0;p=await save(a,p,linkNavigation(p.wireframes,'screen-A',['screen-B'],['header'],()=>`link-${++sequence}`));const before=structuredClone(p);p=await save(a,p,p.wireframes.map(screen=>screen.id==='screen-A'?{...screen,elements:screen.elements.map(element=>element.type==='header'?{...element,text:'자동 동기화 확인'}:element)}:screen));expect(p.wireframes[1].elements[0].text).toBe('자동 동기화 확인');expect(p.wireframes[1].elements[0].id).toBe(before.wireframes[1].elements[0].id);expect(p.wireframes[1].elements[1]).toEqual(before.wireframes[1].elements[1]);
    p=(await send(a,'POST',`/api/projects/${p.id}/flow-versions/${p.selectedFlowVersionId}/wireframe-versions`,{expectedRevision:p.revision,sourceWireframeVersionId:p.selectedWireframeVersionId})).json();const backup=(await a.inject(`/api/projects/${p.id}/backup`)).json();const imported=(await send(a,'POST','/api/backups/restore',backup)).json<Project>();for(const version of selectedVersion(imported).wireframeVersions){const source=version.wireframes[0],follower=version.wireframes[1],binding=follower.navigationSync!.header!;expect(binding.sourceScreenId).toBe(source.id);expect(binding.sourceElementId).toBe(source.elements[0].id);expect(binding.elementIdMap[source.elements[0].id]).toBe(follower.elements[0].id);expect(binding.sourceScreenId).not.toBe('screen-A');expect(binding.elementIdMap['header-A']).toBeUndefined();}
    const exported=await a.inject(`/api/projects/${imported.id}/export?format=html`);expect(exported.body.match(/자동 동기화 확인/g)?.length).toBe(2);
  });

  it('retains current proposals for every listed run beyond the recent-history limit without leaking another project',()=>{
    const store=new WorkspaceStore(':memory:');
    try{
      const project=store.insert(newProject('많은 페이지 재시도')),other=store.insert(newProject('별도 프로젝트'));const currentIds:string[]=[];
      const run=(id:string,proposalId:string,createdAt:string):AiRun=>({id,projectId:project.id,artifact:'wireframes',prompt:'페이지별 생성',status:'succeeded',createdAt,updatedAt:createdAt,output:'',error:null,proposalId,model:'fixture',usage:null});
      const proposal=(id:string,runId:string,createdAt:string,status:Proposal['status'],projectId=project.id):Proposal=>({id,runId,projectId,createdAt,status,summary:'페이지 결과',changes:[],resolvedChangeIds:[]});
      for(let index=0;index<48;index++){
        const runId=`history-run-${index}`,currentId=`history-current-${index}`;currentIds.push(currentId);
        store.putRun(run(runId,currentId,new Date(1700000000000+index*1000).toISOString()));
        for(let attempt=0;attempt<3;attempt++)store.putProposal(proposal(attempt===2?currentId:`history-old-${index}-${attempt}`,runId,new Date(1700000000000+index*1000+attempt*10).toISOString(),attempt===2?'applied':'cancelled'));
      }
      store.putProposal(proposal('foreign-proposal','foreign-run','2030-01-01T00:00:00.000Z','applied',other.id));
      store.putRun(run('missing-proposal-run','missing-proposal','2030-01-02T00:00:00.000Z'));store.putRun(run('foreign-reference-run','foreign-proposal','2030-01-03T00:00:00.000Z'));
      const activity=store.activity(project.id),ids=activity.proposals.map(proposal=>proposal.id);
      expect(activity.runs).toHaveLength(50);expect(currentIds.every(id=>ids.includes(id))).toBe(true);
      expect(ids).toContain('history-old-47-1');expect(ids).not.toContain('foreign-proposal');expect(ids).not.toContain('missing-proposal');expect(new Set(ids).size).toBe(ids.length);
      expect(activity.proposals.every(item=>item.projectId===project.id)).toBe(true);
      expect(activity.proposals).toEqual([...activity.proposals].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)));
      expect(ids.length).toBeGreaterThan(100);
    }finally{store.close();}
  });
});
