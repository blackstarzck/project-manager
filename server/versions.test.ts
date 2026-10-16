import { afterEach,describe,expect,it } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AiRun,Project,WireElement,WireScreen } from '../shared/schema.js';
import { createApp } from './app.js';
import { WorkspaceStore } from './store.js';
import { newProject,wireElements } from './documents.js';
import type { AIProvider } from './provider.js';

type App=Awaited<ReturnType<typeof createApp>>;
const apps:App[]=[];const directories:string[]=[];
const headers={'x-requested-with':'ProjectManager','content-type':'application/json'};
async function app(provider?:AIProvider,dbPath?:string){const instance=await createApp({provider,dbPath});apps.push(instance);return instance;}
async function send(a:App,method:'POST'|'PUT'|'PATCH',url:string,payload:unknown){return a.inject({method,url,headers,payload:JSON.stringify(payload)});}
async function create(a:App):Promise<Project>{return (await send(a,'POST','/api/projects',{name:'독립 버전'})).json();}
async function save(a:App,p:Project,artifact:'flow'|'wireframes'|'features',value:unknown){return send(a,'PUT',`/api/projects/${p.id}/artifacts/${artifact}`,{expectedRevision:p.artifactRevisions[artifact],value,flowVersionId:p.selectedFlowVersionId});}
async function select(a:App,p:Project,id:string):Promise<Project>{const r=await send(a,'POST',`/api/projects/${p.id}/flow-versions/${id}/select`,{expectedRevision:p.revision});expect(r.statusCode).toBe(200);return r.json();}
async function fork(a:App,p:Project,sourceVersionId?:string):Promise<Project>{const r=await send(a,'POST',`/api/projects/${p.id}/flow-groups/${p.flowGroups[0].id}/versions`,{name:'두 번째 버전',sourceVersionId,expectedRevision:p.revision});expect(r.statusCode).toBe(201);return r.json();}
const graph={nodes:[{id:'page',type:'page',label:'대시보드',description:'',position:{x:0,y:0},featureIds:[],sectionId:null}],edges:[],sections:[]};
const element=(id:string,type:WireElement['type'],text='',extra:Partial<WireElement>={}):WireElement=>({id,type,text,targetScreenId:null,...extra});
const screens=(flowRevision:number):WireScreen[]=>[{id:'screen',revision:0,flowNodeId:'page',flowRevision,name:'대시보드',device:'desktop',elements:[element('layout','row','',{children:[element('side','sidebar','메뉴',{children:[element('open','button','예약하기',{action:'openModal',targetElementId:'dialog'})]}),element('main','body','',{children:[element('title','heading','도서관'),element('grid','grid','',{style:{columns:2,gap:16},children:[element('table','table','예약 현황',{columns:['이름','상태'],rows:[['테스트','예약됨']]}),element('next','button','상세 보기',{targetScreenId:'detail',action:'navigate'})]})]})]}),element('dialog','modal','예약 확인',{children:[element('dialog-close','button','확인',{action:'closeModal'})]})]},{id:'detail',revision:0,flowNodeId:'page',flowRevision,name:'상세',device:'desktop',elements:[element('back','button','뒤로 가기',{action:'back'})]}];
afterEach(async()=>{for(const instance of apps.splice(0))await instance.close();for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('independent visual versions and nested wireframes',()=>{
  it('migrates a legacy database once without losing IDs, revisions, pending proposal context, or screen links',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'planit-legacy-'));directories.push(directory);const file=path.join(directory,'legacy.sqlite');const old=new WorkspaceStore(file);const p=old.insert(newProject('이전 프로젝트'));
    const legacy={...p,flow:graph,wireframes:screens(7),artifactRevisions:{...p.artifactRevisions,flow:7,wireframes:3},revision:10} as Partial<Project>;delete legacy.flowGroups;delete legacy.selectedFlowVersionId;
    old.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(legacy),p.id);
    old.putRun({id:'legacy-run',projectId:p.id,artifact:'flow',prompt:'이전 요청',status:'succeeded',createdAt:p.createdAt,updatedAt:p.updatedAt,output:'',error:null,proposalId:'legacy-proposal',model:'fixture',usage:null});
    old.putProposal({id:'legacy-proposal',projectId:p.id,runId:'legacy-run',createdAt:p.createdAt,status:'pending',summary:'이전 변경',changes:[{id:'change',artifact:'flow',entityId:'flow',expectedRevision:7,operation:'upsert',before:graph,after:graph,summary:'이전 변경'}],resolvedChangeIds:[]});old.close();
    const migrated=new WorkspaceStore(file);const actual=migrated.project(p.id);expect(actual.revision).toBe(10);expect(actual.flow).toEqual(graph);expect(actual.wireframes).toEqual(legacy.wireframes);expect(actual.artifactRevisions.flow).toBe(7);expect(actual.flowGroups).toHaveLength(1);expect(migrated.run('legacy-run').flowVersionId).toBe(actual.selectedFlowVersionId);expect(migrated.proposal('legacy-proposal').flowVersionId).toBe(actual.selectedFlowVersionId);migrated.close();
    const reopened=new WorkspaceStore(file);expect(reopened.project(p.id).selectedFlowVersionId).toBe(actual.selectedFlowVersionId);reopened.close();
  });
  it('forks independent editable snapshots and protects another version from stale tab saves',async()=>{
    const a=await app();let p=await create(a);p=(await save(a,p,'flow',graph)).json();p=(await save(a,p,'wireframes',screens(p.artifactRevisions.flow))).json();const firstId=p.selectedFlowVersionId!;const first=structuredClone(p);
    p=await fork(a,p,firstId);const secondId=p.selectedFlowVersionId!;expect(secondId).not.toBe(firstId);expect(p.flow).toEqual(first.flow);expect(p.wireframes).toEqual(first.wireframes);
    const changed=structuredClone(p.wireframes);changed[0].elements[0].children![1].children![0].text='수정된 도서관';p=(await save(a,p,'wireframes',changed)).json();
    const stale=await save(a,first,'flow',{...first.flow,nodes:[]});expect(stale.statusCode).toBe(409);expect(stale.json().code).toBe('FLOW_CONTEXT_CONFLICT');
    p=await select(a,p,firstId);expect(p.wireframes).toEqual(first.wireframes);p=await select(a,p,secondId);expect(wireElements(p.wireframes[0].elements).find(item=>item.id==='title')?.text).toBe('수정된 도서관');
    const blank=await fork(a,p);expect(blank.flow.nodes).toHaveLength(0);expect(blank.wireframes).toHaveLength(0);expect(blank.flowGroups[0].versions).toHaveLength(3);
  });
  it('keeps AI proposals pending across version switches and approves only in captured context',async()=>{
    const provider:AIProvider={model:'fixture',configured:true,async generate({prompt}){const {project}=JSON.parse(prompt);return {summary:'플로우 이름 수정',document:{...project.flow,nodes:project.flow.nodes.map((node:{label:string})=>({...node,label:'AI 변경'}))}};}};
    const a=await app(provider);let p=await create(a);p=(await save(a,p,'flow',graph)).json();const firstId=p.selectedFlowVersionId!;
    const started=(await send(a,'POST',`/api/projects/${p.id}/ai/runs`,{artifact:'flow',prompt:'이름 수정',flowVersionId:firstId})).json<AiRun>();let done=started;for(let i=0;i<100&&['queued','running'].includes(done.status);i++){await new Promise(resolve=>setTimeout(resolve,5));done=(await a.inject(`/api/ai/runs/${started.id}`)).json();}expect(done.status).toBe('succeeded');expect(done.flowVersionId).toBe(firstId);
    p=await fork(a,p,firstId);const wrong=await send(a,'POST',`/api/proposals/${done.proposalId}/resolve`,{action:'approve',commandId:'wrong-context'});expect(wrong.statusCode).toBe(409);expect(wrong.json().code).toBe('FLOW_CONTEXT_CONFLICT');expect((await a.inject(`/api/projects/${p.id}/activity`)).json().proposals[0].status).toBe('pending');
    p=await select(a,p,firstId);const right=await send(a,'POST',`/api/proposals/${done.proposalId}/resolve`,{action:'approve',commandId:'correct-context'});expect(right.statusCode).toBe(200);expect(right.json().project.flow.nodes[0].label).toBe('AI 변경');
    const inactive=right.json().project.flowGroups[0].versions.find((version:{id:string})=>version.id!==firstId);expect(inactive.flow.nodes[0].label).toBe('대시보드');
  });
  it('validates inactive version references, deep bounds, duplicate nested IDs and unsafe styles',async()=>{
    const a=await app();let p=await create(a);p=(await save(a,p,'features',[{id:'requirement',revision:0,parentId:null,kind:'requirement',title:'요구사항',description:'',priority:'medium',status:'planned',roles:[],acceptanceCriteria:[],prdIds:[],favorite:false}])).json();
    p=(await save(a,p,'flow',{...graph,nodes:[{...graph.nodes[0],featureIds:['requirement']}]})).json();p=await fork(a,p);expect((await save(a,p,'features',[])).statusCode).toBe(400);
    p=(await save(a,p,'flow',graph)).json();const nested=screens(p.artifactRevisions.flow);expect((await save(a,p,'wireframes',nested)).statusCode).toBe(200);
    p=(await a.inject(`/api/projects/${p.id}`)).json();const deep=element('deep0','column');let cursor=deep;for(let i=1;i<9;i++){cursor.children=[element(`deep${i}`,'column')];cursor=cursor.children[0];}expect((await save(a,p,'wireframes',[{...p.wireframes[0],elements:[deep]}])).json().code).toBe('WIRE_TREE_LIMIT');
    const duplicate=structuredClone(p.wireframes);duplicate[0].elements[0].children!.push(element('title','text'));expect((await save(a,p,'wireframes',duplicate)).json().code).toBe('DUPLICATE_ID');
    const unsafe=structuredClone(p.wireframes) as unknown as {elements:{style?:unknown}[]}[];unsafe[0].elements[0].style={background:'url(https://example.invalid/steal)'};expect((await save(a,p,'wireframes',unsafe)).statusCode).toBe(400);
  });
  it('allows unfinished action configuration while rejecting invalid supplied targets and hidden leaf children',async()=>{
    const a=await app();let p=await create(a);p=(await save(a,p,'flow',graph)).json();
    const draft:WireScreen={id:'draft',revision:0,flowNodeId:'page',flowRevision:p.artifactRevisions.flow,name:'작업 중 화면',device:'desktop',elements:[element('navigate','button','대상 선택 전',{action:'navigate'}),element('modal-open','button','모달 선택 전',{action:'openModal',targetElementId:null})]};
    const saved=await save(a,p,'wireframes',[draft]);expect(saved.statusCode).toBe(200);p=saved.json();
    const invalid=structuredClone(p.wireframes);invalid[0].elements[1].targetElementId='navigate';expect((await save(a,p,'wireframes',invalid)).json().code).toBe('INVALID_REFERENCE');
    const leaf=structuredClone(p.wireframes);leaf[0].elements[0].children=[element('hidden','text','보이지 않는 자식')];expect((await save(a,p,'wireframes',leaf)).json().code).toBe('INVALID_CHILDREN');
  });
  it('remaps every version and nested navigation reference in backups and exports nested offline actions',async()=>{
    const a=await app();let p=await create(a);p=(await save(a,p,'flow',graph)).json();p=(await save(a,p,'wireframes',screens(p.artifactRevisions.flow))).json();p=await fork(a,p,p.selectedFlowVersionId!);
    const backup=(await a.inject(`/api/projects/${p.id}/backup`)).json();const imported=(await send(a,'POST','/api/backups/restore',backup)).json<Project>();expect(imported.flowGroups[0].versions).toHaveLength(2);expect(imported.flowGroups[0].id).not.toBe(p.flowGroups[0].id);
    for(const version of imported.flowGroups[0].versions){expect(version.id).not.toBe(p.selectedFlowVersionId);expect(version.flow.nodes[0].id).not.toBe('page');const elements=wireElements(version.wireframes[0].elements);const open=elements.find(item=>item.action==='openModal')!;expect(elements.find(item=>item.id===open.targetElementId)?.type).toBe('modal');const nav=elements.find(item=>item.action==='navigate')!;expect(version.wireframes.some(screen=>screen.id===nav.targetScreenId)).toBe(true);expect(elements.some(item=>item.id==='dialog')).toBe(false);}
    const exported=await a.inject(`/api/projects/${p.id}/export?format=html`);expect(exported.statusCode).toBe(200);expect(exported.body).toContain('<table>');expect(exported.body).toContain('예약됨');expect(exported.body).toContain('data-action="openModal"');expect(exported.body).toContain('data-action="back"');expect(exported.body).toContain('<dialog');expect(exported.body).not.toContain('undefined');
  });
  it('keeps independent versions when restoring a whole-project snapshot and persists selection after restart',async()=>{
    const directory=mkdtempSync(path.join(tmpdir(),'planit-version-persist-'));directories.push(directory);const file=path.join(directory,'workspace.sqlite');let a=await app(undefined,file);let p=await create(a);p=(await save(a,p,'flow',graph)).json();const revision=(await a.inject(`/api/projects/${p.id}/revisions`)).json()[0];p=await fork(a,p,p.selectedFlowVersionId!);const count=p.flowGroups[0].versions.length;
    const restored=await send(a,'POST',`/api/projects/${p.id}/revisions/${revision.id}/restore`,{expectedRevision:p.revision});expect(restored.statusCode).toBe(200);p=restored.json();expect(p.flowGroups[0].versions).toHaveLength(count+1);const selected=p.selectedFlowVersionId;await a.close();apps.splice(apps.indexOf(a),1);a=await app(undefined,file);expect((await a.inject(`/api/projects/${p.id}`)).json().selectedFlowVersionId).toBe(selected);
  });
});
