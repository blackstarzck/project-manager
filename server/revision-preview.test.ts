import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.js';
import { newProject } from './documents.js';
import { WorkspaceStore } from './store.js';
import type { Project, Revision } from '../shared/schema.js';

const applications: Awaited<ReturnType<typeof createApp>>[] = [];
const folders: string[] = [];
const headers = {'x-requested-with':'ProjectManager','content-type':'application/json'};
async function setup() {
  const folder = mkdtempSync(path.join(tmpdir(), 'planit-revision-preview-')); folders.push(folder);
  const dbPath = path.join(folder,'workspace.sqlite');
  const app = await createApp({dbPath,provider:{configured:false,model:'disabled-preview-test',async generate(){throw new Error('No AI in revision preview tests');}}});
  applications.push(app);
  const create = async(name:string) => (await app.inject({method:'POST',url:'/api/projects',headers,payload:{name}})).json<Project>();
  return {app,dbPath,create};
}
function dataState(dbPath:string) {
  const db = new DatabaseSync(dbPath,{readOnly:true});
  try {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
    return {
      schema:db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(),
      tables:tables.map(row=>({name:row.name,rows:db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"','""')}"`).all()})),
      version:db.prepare('PRAGMA user_version').get(),
    };
  } finally { db.close(); }
}
afterEach(async()=>{
  for(const app of applications.splice(0)) await app.close();
  for(const folder of folders.splice(0)) {
    const resolved=path.resolve(folder);
    if(path.dirname(resolved)!==path.resolve(tmpdir()) || !path.basename(resolved).startsWith('planit-revision-preview-')) throw new Error('Unexpected cleanup path');
    rmSync(resolved,{recursive:true,force:true});
  }
});

it('previews the historical body without changing any table, current document, or existing revision response',async()=>{
  const {app,dbPath,create}=await setup(); let project=await create('과거 본문 검수');
  const item={id:'intro',revision:0,section:'overview',title:'이전 제품 정의',content:'<p>이전 예약 정책</p>'};
  project=(await app.inject({method:'PUT',url:`/api/projects/${project.id}/artifacts/prd`,headers,payload:{expectedRevision:0,value:[item]}})).json();
  const revisions=(await app.inject(`/api/projects/${project.id}/revisions`)).json<Revision[]>();
  const target=revisions.find(row=>row.revision===1)!;
  project=(await app.inject({method:'PUT',url:`/api/projects/${project.id}/artifacts/prd`,headers,payload:{expectedRevision:project.artifactRevisions.prd,value:[{...project.prd[0],content:'<p>현재 예약 정책</p>'}]}})).json();
  const before=dataState(dbPath);
  const response=await app.inject(`/api/projects/${project.id}/revisions/${target.id}`);
  expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json<Project>().prd[0].content).toBe('<p>이전 예약 정책</p>');
  expect(response.json<Project>().revision).toBe(1);
  expect((await app.inject(`/api/projects/${project.id}`)).json()).toEqual(project);
  expect(Object.keys(target).sort()).toEqual(['createdAt','id','label','projectId','revision']);
  expect(dataState(dbPath)).toEqual(before);
});

it('does not expose another project revision or a missing revision/project',async()=>{
  const {app,create}=await setup(); const first=await create('A'), second=await create('B');
  const revision=(await app.inject(`/api/projects/${first.id}/revisions`)).json<Revision[]>()[0];
  for(const url of [`/api/projects/${second.id}/revisions/${revision.id}`,`/api/projects/${first.id}/revisions/missing`,`/api/projects/missing/revisions/${revision.id}`]) {
    const response=await app.inject(url); expect(response.statusCode).toBe(404); expect(response.json().code).toBe('NOT_FOUND'); expect(response.body).not.toContain(first.name);
  }
});

it('keeps local host and origin protections on historical content',async()=>{
  const {app,create}=await setup(); const project=await create('비공개 문서');
  const revision=(await app.inject(`/api/projects/${project.id}/revisions`)).json<Revision[]>()[0];
  const url=`/api/projects/${project.id}/revisions/${revision.id}`;
  for(const guardedHeaders of [{host:'example.com'}, {origin:'https://example.com'}, {'sec-fetch-site':'cross-site'}]) {
    const response=await app.inject({url,headers:guardedHeaders}); expect(response.statusCode).toBe(403); expect(response.body).not.toContain(project.name);
  }
});

it('normalizes legacy snapshot shape only in memory',()=>{
  const store=new WorkspaceStore(':memory:');
  try {
    const project=store.insert(newProject('이전 형식')); const revision=store.revisions(project.id)[0];
    const legacy=structuredClone(project) as Partial<Project>; delete legacy.flowGroups; delete legacy.selectedFlowVersionId; delete legacy.selectedWireframeVersionId;
    const raw=JSON.stringify(legacy); store.db.prepare('UPDATE revisions SET data=? WHERE id=?').run(raw,revision.id);
    const auditBefore=store.db.prepare('SELECT COUNT(*) AS n FROM audit').get();
    const preview=store.revisionSnapshot(project.id,revision.id); expect(preview.flowGroups.length).toBeGreaterThan(0);
    expect(store.db.prepare('SELECT data FROM revisions WHERE id=?').get(revision.id)?.data).toBe(raw);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM audit').get()).toEqual(auditBefore);
  } finally {store.close();}
});
