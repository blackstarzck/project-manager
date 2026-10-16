// Explicit opt-in real Groq smoke. Not part of automatic tests; uses synthetic data only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { loadEnvironment } from '../server/config.js';
import { wireElements } from '../server/documents.js';
import type { AiRun, Project } from '../shared/schema.js';

loadEnvironment();
if(!process.env.GROQ_API_KEY)throw new Error('GROQ_API_KEY is not configured.');
const directory=path.resolve('.qa-data',`live-nested-${Date.now()}`);
mkdirSync(directory,{recursive:true});
const dbPath=path.join(directory,'smoke.sqlite');
let app=await createApp({dbPath});
const headers={'content-type':'application/json','x-requested-with':'ProjectManager'};
const call=async<T>(method:'GET'|'POST'|'PUT',url:string,payload?:unknown):Promise<T>=>{
  const response=await app.inject({method,url,headers,...(payload===undefined?{}:{payload:JSON.stringify(payload)})});
  if(response.statusCode>=400)throw new Error(`HTTP ${response.statusCode}: ${response.json().error}`);
  return response.json() as T;
};
const report:{status:string;startedAt:string;model:string;steps:unknown[];error?:string}={status:'running',startedAt:new Date().toISOString(),model:process.env.GROQ_MODEL||'openai/gpt-oss-120b',steps:[]};
try{
  let project=await call<Project>('POST','/api/projects',{name:'중첩 화면 실제 AI 검수',description:'동네 도서관의 도서 예약 관리 화면. 가상의 검수 예제로 실제 회원 정보는 사용하지 않습니다.'});
  project=await call<Project>('PUT',`/api/projects/${project.id}/artifacts/flow`,{expectedRevision:0,flowVersionId:project.selectedFlowVersionId,value:{nodes:[{id:'library-page',type:'page',label:'도서 예약 관리',description:'도서 목록과 예약 안내 모달',position:{x:0,y:0},featureIds:[],sectionId:null}],edges:[],sections:[]}});
  const original=structuredClone(project);
  let run=await call<AiRun>('POST',`/api/projects/${project.id}/ai/runs`,{artifact:'wireframes',flowVersionId:project.selectedFlowVersionId,entityIds:['library-page'],prompt:'도서 예약 관리 데스크톱 화면을 정확히 1개 만드세요. 총요소 15개 이하로 간결하게: header, row 아래 sidebar와 body, body 안에 제목과 도서 목록 table(열2/행2)과 안내버튼. root에 안내 modal을 두고 버튼 action openModal/targetElementId로 연결하고 모달 내부 닫기 버튼 action closeModal. 올바른 중첩 children과 스타일을 쓰세요. 화면은 이 프로젝트의 library-page를 참조하세요.'});
  const started=Date.now();
  while(run.status==='queued'||run.status==='running'){
    if(Date.now()-started>180000){await call('POST',`/api/ai/runs/${run.id}/cancel`,{});throw new Error('Real generation timed out.');}
    await new Promise(resolve=>setTimeout(resolve,500));run=await call<AiRun>('GET',`/api/ai/runs/${run.id}`);
  }
  if(run.status!=='succeeded')throw new Error(run.error||`Unexpected status: ${run.status}`);
  assert.deepEqual((await call<Project>('GET',`/api/projects/${project.id}`)).wireframes,[]);
  const applied=await call<{project:Project}>('POST',`/api/proposals/${run.proposalId}/resolve`,{action:'approve',commandId:randomUUID()});project=applied.project;
  const elements=project.wireframes.flatMap(screen=>wireElements(screen.elements));
  assert.equal(project.wireframes.length,1);assert(elements.some(item=>item.type==='table'));assert(elements.some(item=>item.type==='modal'));assert(elements.some(item=>item.action==='openModal'));assert(elements.some(item=>(item.children||[]).some(child=>child.children?.length)));
  report.steps.push({name:'real nested generation and approval',status:'passed',elapsedMs:Date.now()-started,screenCount:project.wireframes.length,elementCount:elements.length,containerTypes:[...new Set(elements.filter(item=>item.children?.length).map(item=>item.type))]});
  const originalVersionId=project.selectedFlowVersionId!,originalScreen=structuredClone(project.wireframes);
  project=await call<Project>('POST',`/api/projects/${project.id}/flow-groups/${project.flowGroups[0].id}/versions`,{name:'독립 수정본',sourceVersionId:originalVersionId,expectedRevision:project.revision});
  const changed=structuredClone(project.wireframes);wireElements(changed[0].elements).find(item=>item.type==='heading')!.text='수정본에서만 편집한 제목';
  project=await call<Project>('PUT',`/api/projects/${project.id}/artifacts/wireframes`,{flowVersionId:project.selectedFlowVersionId,expectedRevision:project.artifactRevisions.wireframes,value:changed});
  assert.deepEqual(project.flowGroups.flatMap(group=>group.versions).find(version=>version.id===originalVersionId)!.wireframes,originalScreen);
  assert.equal(project.id,original.id);report.steps.push({name:'independent copied version preserves original',status:'passed'});
  const expected=structuredClone(project);await app.close();app=await createApp({dbPath});project=await call<Project>('GET',`/api/projects/${project.id}`);assert.deepEqual(project,expected);
  report.steps.push({name:'server restart persistence',status:'passed'});report.status='passed';
  writeFileSync(path.join(directory,'project-backup.json'),JSON.stringify({format:'planit-backup',version:1,project},null,2));
  console.log(JSON.stringify({status:report.status,report:path.join(directory,'report.json'),steps:report.steps}));
}catch(error){report.status='failed';report.error=error instanceof Error?error.message:'Unknown error';console.log(JSON.stringify({status:report.status,error:report.error,report:path.join(directory,'report.json')}));process.exitCode=1;}
finally{writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));await app.close();}
