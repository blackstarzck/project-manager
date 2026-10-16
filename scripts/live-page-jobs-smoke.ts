// Manual, explicitly authorized real-provider integration. Never part of automated tests.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadEnvironment } from '../server/config.js';
import { AppError } from '../server/errors.js';
import { GroqProvider, type AIProvider, type GenerationInput } from '../server/provider.js';
import { projectSchema, type AiRun, type Project, type ProjectActivity, type Proposal } from '../shared/schema.js';

if (!process.argv.includes('--allow-live')) throw new Error('Explicit opt-in required: npx tsx scripts/live-page-jobs-smoke.ts --allow-live');
loadEnvironment();
process.env.GROQ_MAX_TOKENS = '3000';
const real = new GroqProvider();
if (!real.configured) throw new Error('Groq is not configured. No request sent.');
const resumeIndex=process.argv.indexOf('--resume');
const resume=resumeIndex>=0?process.argv[resumeIndex+1]:undefined;
if(resumeIndex>=0&&!resume)throw new Error('--resume requires the previous smoke directory.');
const directory = resume?path.resolve(resume):path.resolve('.qa-data',`live-page-jobs-${Date.now()}`);
if(resume&&!directory.startsWith(path.resolve('.qa-data')+path.sep))throw new Error('Resume must use a smoke directory inside .qa-data.');
mkdirSync(directory,{recursive:true});
const dbPath = path.join(directory,'smoke.sqlite');
const report = {status:'running',startedAt:new Date().toISOString(),endedAt:'',model:real.model,maxCalls:6,maxCompletionTokensPerCall:3000,realCalls:[] as {page:string;phase:string;attempt:number;durationMs:number;status:string;code?:string;usage:null}[],injections:[] as {phase:string;page:string;kind:string}[],steps:[] as {name:string;status:string;details?:unknown}[],error:undefined as string|undefined,usageNote:'GroqProvider does not expose token usage; counts/costs are not estimated.'};
if(resume){const previous=JSON.parse(readFileSync(path.join(directory,'report.json'),'utf8'));if(!existsSync(path.join(directory,'report-initial.json')))copyFileSync(path.join(directory,'report.json'),path.join(directory,'report-initial.json'));Object.assign(report,previous,{status:'running',endedAt:'',error:undefined});report.steps.push({name:'explicit resume after initial AI_RATE_LIMIT; completed append reused',status:'started',details:{at:new Date().toISOString(),priorRealCalls:report.realCalls.length,priorStop:previous.error}});}
let phase:'append-retry'|'regenerate-partial'|'cancel' = resume?'regenerate-partial':'append-retry';
let naturalFailure = false, gateReached = false;
const provider: AIProvider = {
  model:real.model,configured:real.configured,
  async generate(input: GenerationInput) {
    const task = (JSON.parse(input.prompt) as {pageTask:{pageId:string;label:string;attempt:number}}).pageTask;
    if (naturalFailure) throw new AppError(502,'SMOKE_STOPPED','A prior real-provider error stopped further real calls.');
    if (task.pageId === 'page-b' && (phase === 'regenerate-partial' || task.attempt === 1)) {
      report.injections.push({phase,page:task.pageId,kind:'Explicit synthetic failure before provider; not a Groq outage'});
      throw new AppError(502,'SMOKE_INJECTED_FAILURE','검수용 제공자 호출 전 주입 실패입니다. 실제 Groq 장애가 아닙니다.');
    }
    if (phase === 'cancel' && task.pageId === 'page-d') {
      report.injections.push({phase,page:task.pageId,kind:'Pre-provider cancellation gate; no real call'}); gateReached = true;
      await new Promise<void>((_resolve,reject) => { const cancel=()=>reject(new AppError(499,'SMOKE_CANCELLED','검수용 호출 전 취소')); if(input.signal.aborted)cancel();else input.signal.addEventListener('abort',cancel,{once:true}); });
    }
    if (report.realCalls.length >= report.maxCalls) throw new AppError(409,'SMOKE_CALL_LIMIT','Manual smoke call limit reached.');
    const metric = {page:task.pageId,phase,attempt:task.attempt,durationMs:0,status:'running',usage:null,code:undefined as string|undefined};
    report.realCalls.push(metric); const started = Date.now();
    console.log(`Real Groq call ${report.realCalls.length}/${report.maxCalls}: ${phase}, ${task.pageId}`);
    try { const result = await real.generate(input); metric.status='succeeded'; return result; }
    catch(error) { naturalFailure=true;metric.status='failed';metric.code=error instanceof AppError?error.code:'UNKNOWN';throw error; }
    finally { metric.durationMs=Date.now()-started; }
  },
};
let app = await createApp({dbPath,provider});
const headers = {'content-type':'application/json','x-requested-with':'ProjectManager'};
async function call<T>(method:'GET'|'POST'|'PUT',url:string,payload?:unknown):Promise<T> {
  const response = await app.inject({method,url,headers,...(payload===undefined?{}:{payload:JSON.stringify(payload)})});
  if(response.statusCode>=400){const error=response.json();throw new AppError(response.statusCode,error.code||'HTTP_ERROR',error.error||'Request failed.');}
  return response.json() as T;
}
async function terminal(id:string):Promise<AiRun> {
  const start=Date.now();
  while(true){const run=await call<AiRun>('GET',`/api/ai/runs/${id}`);if(!['queued','running'].includes(run.status))return run;if(Date.now()-start>240000){await call('POST',`/api/ai/runs/${id}/cancel`,{});throw new Error('Timed out; no retry attempted.');}await new Promise(resolve=>setTimeout(resolve,250));}
}
function requireSuccess(run:AiRun,count:number) { if(naturalFailure)throw new Error(`Real provider stopped with ${report.realCalls.findLast(call=>call.status==='failed')?.code || 'UNKNOWN'}; no automatic retry.`); assert.equal(run.pageSummary?.succeeded,count,`Expected ${count} schema-valid successful pages; task errors: ${run.pageTasks?.map(task=>task.error).filter(Boolean).join(' | ')}`); }
const originScreens=(project:Project,id:string)=>project.flowGroups.flatMap(group=>group.versions).flatMap(flow=>flow.wireframeVersions).find(version=>version.id===id)!.wireframes;
const prompt='합성 검수용 가상 도서관 서비스입니다. 현재 pageTask에 해당하는 desktop 화면을 정확히 1개만 생성하세요. 총 요소 7개 이하: header 안 간단한 제목, body 안 제목·본문·버튼, footer. 모든 targetScreenId는 null로 두세요. 모달·표·화면 간 링크는 만들지 마세요. 기존 화면/요소 ID를 유지하고 기존 화면이면 본문에 “실제 연동 검수 완료”를 반영하세요. 모든 children은 완전한 요소 객체여야 합니다.';
async function start(project:Project,mode:'append'|'regenerate',ids:string[]) { return call<AiRun>('POST',`/api/projects/${project.id}/ai/runs`,{artifact:'wireframes',prompt,flowVersionId:project.selectedFlowVersionId,wireframeVersionId:project.selectedWireframeVersionId,wireframeGenerationMode:mode,entityIds:ids}); }
async function approve(run:AiRun,allowPartial=false) { assert(run.proposalId);return call<{project:Project;proposal:Proposal}>('POST',`/api/proposals/${run.proposalId}/resolve`,{action:'approve',commandId:randomUUID(),...(allowPartial?{allowPartial:true}:{})}); }
const passed=(name:string,details?:unknown)=>{report.steps.push({name,status:'passed',details});console.log(`PASS: ${name}`);};

try {
  let project:Project,run:AiRun,resumedRegenerate:AiRun|undefined;
  if(resume){
    const summaries=await call<{id:string}[]>('GET','/api/projects');assert.equal(summaries.length,1,'Resume database must contain only the synthetic project.');
    project=await call<Project>('GET',`/api/projects/${summaries[0].id}`);
    resumedRegenerate=(await call<ProjectActivity>('GET',`/api/projects/${project.id}/activity`)).runs.find(item=>item.wireframeGenerationMode==='regenerate'&&item.status==='failed');
    assert(resumedRegenerate,'No failed regenerate run to resume.');assert.equal(project.selectedWireframeVersionId,resumedRegenerate.wireframeVersionId);assert.equal(project.wireframes.length,2);
  }else{
  project=await call<Project>('POST','/api/projects',{name:'실제 Groq 페이지 작업 합성 검수',description:'가상 도서관 예제만 사용하는 임시 통합 검수. 실제 사용자 정보 없음.'});
  project=await call<Project>('PUT',`/api/projects/${project.id}/artifacts/flow`,{expectedRevision:project.artifactRevisions.flow,flowVersionId:project.selectedFlowVersionId,value:{nodes:['a','b','c','d'].map((letter,index)=>({id:`page-${letter}`,type:'page',label:['도서 검색','예약 확인','대출 현황','이용 안내'][index],description:'합성 검수 페이지',position:{x:index*250,y:0},featureIds:[],sectionId:null})),edges:[],sections:[]}});
  const initial=structuredClone(project),initialVersion=project.selectedWireframeVersionId!;
  run=await terminal((await start(project,'append',['page-a','page-b'])).id);
  requireSuccess(run,1);assert.equal(run.pageSummary?.failed,1);assert.deepEqual(await call<Project>('GET',`/api/projects/${project.id}`),initial);
  const successfulTask=structuredClone(run.pageTasks!.find(task=>task.status==='succeeded')!),oldProposal=run.proposalId;
  passed('append real success + explicitly injected failure leaves source untouched',run.pageSummary);
  await call('POST',`/api/ai/runs/${run.id}/retry-pages`,{pageTaskIds:run.pageTasks!.filter(task=>task.status==='failed').map(task=>task.id),commandId:randomUUID()});
  run=await terminal(run.id);requireSuccess(run,2);assert.deepEqual(run.pageTasks!.find(task=>task.id===successfulTask.id),successfulTask);
  const activity=await call<ProjectActivity>('GET',`/api/projects/${project.id}/activity`);assert.equal(activity.proposals.find(proposal=>proposal.id===oldProposal)?.status,'cancelled');
  project=(await approve(run)).project;projectSchema.parse(project);assert.equal(project.wireframes.length,2);assert.deepEqual(originScreens(project,initialVersion),[]);
  passed('failed-only retry preserves completed task, supersedes old proposal, approves separate result', {calls:report.realCalls.length});

  }
  phase='regenerate-partial';const beforeRegenerate=structuredClone(project),regenerateOrigin=project.selectedWireframeVersionId!,failedScreen=structuredClone(project.wireframes.find(screen=>screen.flowNodeId==='page-b')!);
  run=await terminal(resumedRegenerate?(await call<AiRun>('POST',`/api/ai/runs/${resumedRegenerate.id}/retry-pages`,{pageTaskIds:resumedRegenerate.pageTasks!.filter(task=>task.status==='failed').map(task=>task.id),commandId:randomUUID()})).id:(await start(project,'regenerate',project.wireframes.map(screen=>screen.id))).id);requireSuccess(run,1);assert.equal(run.pageSummary?.failed,1);
  await assert.rejects(approve(run),error=>error instanceof AppError&&error.code==='PARTIAL_APPROVAL_REQUIRED');
  assert.deepEqual(await call<Project>('GET',`/api/projects/${project.id}`),beforeRegenerate);
  const partial=await approve(run,true);project=partial.project;assert.equal(partial.proposal.partial,true);assert.deepEqual(originScreens(project,regenerateOrigin),beforeRegenerate.wireframes);assert.deepEqual(project.wireframes.find(screen=>screen.id===failedScreen.id),failedScreen);projectSchema.parse(project);
  passed('regenerate partial approval requires explicit opt-in and preserves failed original screen',run.pageSummary);

  phase='cancel';const beforeCancel=structuredClone(project),cancelOrigin=project.selectedWireframeVersionId!;
  run=await start(project,'append',['page-c','page-d']);const gateStart=Date.now();
  while(!gateReached){const latest=await call<AiRun>('GET',`/api/ai/runs/${run.id}`);if(!['queued','running'].includes(latest.status))throw new Error('Run finished before cancellation gate.');if(Date.now()-gateStart>240000){await call('POST',`/api/ai/runs/${run.id}/cancel`,{});throw new Error('Cancellation gate timed out.');}await new Promise(resolve=>setTimeout(resolve,100));}
  run=await call<AiRun>('POST',`/api/ai/runs/${run.id}/cancel`,{});requireSuccess(run,1);assert.equal(run.status,'cancelled');assert.equal(run.proposalId,null);assert.deepEqual(await call<Project>('GET',`/api/projects/${project.id}`),beforeCancel);
  const completed=structuredClone(run.pageTasks!.find(task=>task.status==='succeeded')!),callsBeforeRestart=report.realCalls.length;
  await app.close();app=await createApp({dbPath,provider});run=await call<AiRun>('GET',`/api/ai/runs/${run.id}`);assert.deepEqual(run.pageTasks!.find(task=>task.id===completed.id),completed);assert.equal(run.status,'cancelled');
  run=await call<AiRun>('POST',`/api/ai/runs/${run.id}/prepare-proposal`,{commandId:randomUUID()});project=(await approve(run,true)).project;
  assert.equal(report.realCalls.length,callsBeforeRestart);assert.deepEqual(originScreens(project,cancelOrigin),beforeCancel.wireframes);assert.equal(project.wireframes.length,3);assert(!project.wireframes.some(screen=>screen.flowNodeId==='page-d'));projectSchema.parse(project);
  passed('cancel prevents next real call, restart retains successes, explicit prepare/partial approval uses zero additional calls',{calls:report.realCalls.length});
  writeFileSync(path.join(directory,'synthetic-project.json'),JSON.stringify(project,null,2));
  report.status='passed';
} catch(error) {report.status='failed';report.error=error instanceof AppError?`${error.code}: ${error.message}`:error instanceof Error?error.message.slice(0,1500):'Unknown failure';process.exitCode=1;}
finally {await app.close();report.endedAt=new Date().toISOString();writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,realCalls:report.realCalls.length,error:report.error,report:path.join(directory,'report.json')}));}
