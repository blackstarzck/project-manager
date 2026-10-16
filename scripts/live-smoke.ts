// Explicit manual integration check. This sends synthetic planning data to the configured Groq account.
// Never included in pnpm test or fixture E2E runs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { loadEnvironment } from '../server/config.js';
import type { AiRun, Artifact, Project } from '../shared/schema.js';

loadEnvironment();
if(!process.env.GROQ_API_KEY)throw new Error('GROQ_API_KEY is not configured.');
const resumeIndex=process.argv.indexOf('--resume');
const resume=resumeIndex>=0?process.argv[resumeIndex+1]:undefined;
const directory=path.resolve(resume||path.join('.qa-data',`live-${Date.now()}`));mkdirSync(directory,{recursive:true});
const app=await createApp({dbPath:path.join(directory,'smoke.sqlite')});
const headers={'content-type':'application/json','x-requested-with':'ProjectManager'};
const call=async<T>(method:'GET'|'POST',url:string,payload?:unknown):Promise<T>=>{
  const response=await app.inject({method,url,headers,...(payload===undefined?{}:{payload:JSON.stringify(payload)})});
  if(response.statusCode>=400)throw new Error(`HTTP ${response.statusCode} ${response.json().code || ''}: ${response.json().error}`);
  return response.json() as T;
};
const report:{provider:string;model:string;startedAt:string;steps:unknown[];projectId?:string;status:string}=resume?JSON.parse(readFileSync(path.join(directory,'report.json'),'utf8')):{provider:'groq',model:process.env.GROQ_MODEL||'openai/gpt-oss-120b',startedAt:new Date().toISOString(),steps:[],status:'running'};
report.status='running';
try{
  let project=resume&&report.projectId?await call<Project>('GET',`/api/projects/${report.projectId}`):await call<Project>('POST','/api/projects',{name:'실제 AI 검수 · 동네 도서관',description:'회원이 도서를 검색하고 예약한 뒤 도서관에서 수령하는 소규모 서비스. 이 프로젝트는 자동 검수를 위한 합성 예제입니다.'});
  report.projectId=project.id;
  const requests:Record<Artifact,string>={
    prd:'동네 도서관의 도서 검색·예약 서비스를 기획해 주세요. 회원과 사서 역할, 검색과 예약, 예약 취소 기한을 포함하세요. 다섯 섹션마다 간결한 항목 하나씩 총5개를 작성해 주세요.',
    features:'PRD를 기반으로 도서 검색과 예약을 위한 최소 기능명세를 작성하세요. 요구사항2개, 각각 기능1개와 하위 기능1개로 총6개 항목. 기존 PRD ID를 정확히 참조하세요.',
    flow:'도서 검색 페이지와 도서 상세 페이지 두 화면을 연결하는 간결한 흐름을 작성하세요. 시작1개, 페이지2개, 액션1개 총4개 노드. 기존 기능ID만 참조하고 페이지 사이 연결선을 포함하세요.',
    wireframes:'플로우의 두 페이지를 와이어프레임으로 작성하세요. 각 화면 요소4개 이내로 간결하게. 두 화면은 버튼으로 서로 이동 가능하게 연결하세요. 페이지ID와 화면 링크ID를 정확히 사용하세요.',
  };
  const artifacts=(process.argv.includes('--prd-only')?['prd']:['prd','features','flow','wireframes']) as Artifact[];
  for(const artifact of artifacts){
    if(resume&&report.steps.some(step=>typeof step==='object'&&step!==null&&'artifact' in step&&step.artifact===artifact&&'status' in step&&step.status==='passed'))continue;
    const started=Date.now();
    let run=await call<AiRun>('POST',`/api/projects/${project.id}/ai/runs`,{artifact,prompt:requests[artifact]});
    process.stdout.write(`${artifact}: requested\n`);
    while(run.status==='queued'||run.status==='running'){
      if(Date.now()-started>180000){await call('POST',`/api/ai/runs/${run.id}/cancel`,{});throw new Error(`${artifact}: timed out`);}
      await new Promise(resolve=>setTimeout(resolve,500));
      run=await call<AiRun>('GET',`/api/ai/runs/${run.id}`);
    }
    if(run.status!=='succeeded'||!run.proposalId)throw new Error(`${artifact}: ${run.error||run.status}`);
    const before=await call<Project>('GET',`/api/projects/${project.id}`);
    if(before.revision!==project.revision)throw new Error(`${artifact}: unapproved mutation`);
    const result=await call<{project:Project}>('POST',`/api/proposals/${run.proposalId}/resolve`,{action:'approve',commandId:randomUUID()});
    project=result.project;
    const count=artifact==='flow'?project.flow.nodes.length:project[artifact].length;
    if(!count)throw new Error(`${artifact}: empty generated artifact`);
    const step={artifact,status:'passed',count,durationMs:Date.now()-started,runId:run.id,projectRevision:project.revision};report.steps.push(step);process.stdout.write(`${artifact}: generated, approved, persisted (${count})\n`);
    writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  }
  writeFileSync(path.join(directory,'project-backup.json'),JSON.stringify({format:'planit-backup',version:1,project},null,2));
  await app.close();
  const reopened=await createApp({dbPath:path.join(directory,'smoke.sqlite')});
  const loaded=(await reopened.inject({method:'GET',url:`/api/projects/${project.id}`})).json() as Project;
  if(JSON.stringify(loaded)!==JSON.stringify(project))throw new Error('Restart persistence mismatch');
  await reopened.close();
  report.steps.push({scenario:'server-restart',status:'passed'});report.status='passed';
}catch(error){report.status='failed';report.steps.push({error:error instanceof Error?error.message:'Unknown integration failure'});process.exitCode=1;}
finally{await app.close();writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(directory,'report.json'),steps:report.steps}));}
