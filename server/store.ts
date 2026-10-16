import { DatabaseSync } from 'node:sqlite';
import { type AiRun, type Artifact, type Project, type ProjectSummary, type Proposal, type Revision, type FlowGroup, type FlowVersion, type FlowDocument, type FlowGenerationMode, type WireScreen } from '../shared/schema.js';
import { AppError, assert } from './errors.js';
import { assignEntityRevisions, equal, now, uid, validateProject, selectedVersion, syncSelectedVersion, projectWithVersion, selectedWireframeVersion, projectWithWireframeVersion, initialWireframeVersion } from './documents.js';
import { syncNavigation } from './navigation.js';

export class WorkspaceStore {
  readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL, created_at TEXT NOT NULL, label TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS revision_project ON revisions(project_id,revision);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposal_resolutions(proposal_id TEXT NOT NULL, change_id TEXT NOT NULL, action TEXT NOT NULL, PRIMARY KEY(proposal_id,change_id));
      CREATE TABLE IF NOT EXISTS entity_versions(project_id TEXT NOT NULL, artifact TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(project_id,artifact,entity_id));
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL);
      `);
    this.transaction(() => {
      for(const row of this.db.prepare('SELECT id,data FROM projects').all()){
        const original=JSON.parse(row.data as string);const migrated=validateProject(original);
        if(!equal(original,migrated))this.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(migrated),row.id as string);
        this.recordEntityVersions(migrated);
      }
      for (const row of this.db.prepare('SELECT data FROM runs').all()) {
        const run = JSON.parse(row.data as string) as AiRun;
        if((run.artifact==='flow'||run.artifact==='wireframes')&&!run.flowVersionId)run.flowVersionId=this.project(run.projectId).selectedFlowVersionId!;
        if(run.artifact==='wireframes'&&!run.wireframeVersionId)run.wireframeVersionId=this.project(run.projectId).flowGroups.flatMap(group=>group.versions).find(version=>version.id===run.flowVersionId)?.selectedWireframeVersionId||undefined;
        if (run.status === 'running' || run.status === 'queued') {
          if(run.pageTasks){run.pageTasks=run.pageTasks.map(task=>task.status==='queued'||task.status==='running'?{...task,status:'cancelled',error:'앱이 재시작되어 이 페이지 생성이 중단되었습니다.'}:task);run.pageSummary={total:run.pageTasks.length,succeeded:run.pageTasks.filter(task=>task.status==='succeeded').length,failed:run.pageTasks.filter(task=>task.status==='failed').length,cancelled:run.pageTasks.filter(task=>task.status==='cancelled').length};}
          this.putRun({...run,status:'failed',error:'앱이 재시작되어 생성이 중단되었습니다. 완료한 페이지는 보존되었습니다. 다시 시도해 주세요.',updatedAt:now()});
        }else this.putRun(run);
      }
      for(const row of this.db.prepare('SELECT data FROM proposals').all()){
        const proposal=JSON.parse(row.data as string) as Proposal;
        if(!proposal.flowVersionId&&proposal.changes.some(change=>change.artifact==='flow'||change.artifact==='wireframes'))proposal.flowVersionId=this.project(proposal.projectId).selectedFlowVersionId!;
        if(!proposal.wireframeVersionId&&proposal.changes.some(change=>change.artifact==='wireframes'))proposal.wireframeVersionId=this.project(proposal.projectId).flowGroups.flatMap(group=>group.versions).find(version=>version.id===proposal.flowVersionId)?.selectedWireframeVersionId||undefined;
        this.putProposal(proposal);
      }
      this.db.exec('PRAGMA user_version=3');
    });
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  project(id: string): Project {
    const row = this.db.prepare('SELECT data FROM projects WHERE id=?').get(id);
    if (!row) throw new AppError(404,'NOT_FOUND','프로젝트를 찾을 수 없습니다.');
    return JSON.parse(row.data as string) as Project;
  }
  projectAtRevision(id:string,revision:number):Project {
    const row=this.db.prepare('SELECT data FROM revisions WHERE project_id=? AND revision=? ORDER BY rowid DESC LIMIT 1').get(id,revision);
    assert(row,'SNAPSHOT_NOT_FOUND','생성을 시작한 원본 문서 버전을 찾을 수 없습니다.',409);return validateProject(JSON.parse(row.data as string));
  }
  list(archived = false): ProjectSummary[] {
    return this.db.prepare('SELECT data FROM projects').all().map(row => JSON.parse(row.data as string) as Project).filter(p => Boolean(p.archivedAt) === archived).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(p => ({id:p.id,name:p.name,description:p.description,createdAt:p.createdAt,updatedAt:p.updatedAt,archivedAt:p.archivedAt,revision:p.revision,counts:{prd:p.prd.length,features:p.features.length,flows:p.flow.nodes.length,screens:p.wireframes.length}}));
  }
  insert(project: Project, label = '프로젝트 생성') {
    const p = validateProject(project);
    this.transaction(() => {
      this.db.prepare('INSERT INTO projects(id,data) VALUES(?,?)').run(p.id,JSON.stringify(p));
      this.snapshot(p,label); this.recordEntityVersions(p);
    });
    return p;
  }
  commit(previous: Project, input: Project, label: string, artifacts: Artifact[]): Project {
    if(artifacts.includes('wireframes'))input={...input,wireframes:syncNavigation(previous.wireframes,input.wireframes)};
    let next = validateProject(input);
    next.revision = previous.revision + 1; next.updatedAt = now();
    for (const artifact of artifacts) {
      next.artifactRevisions[artifact] = previous.artifactRevisions[artifact] + 1;
      assignEntityRevisions(previous,next,artifact,(kind,id) => this.highWater(previous.id,kind,id));
    }
    if(artifacts.some(artifact=>artifact==='flow'||artifact==='wireframes')){const version=selectedVersion(next);version.revision=selectedVersion(previous).revision+1;version.updatedAt=next.updatedAt;}
    if(artifacts.includes('wireframes')){const version=selectedWireframeVersion(next);version.revision=selectedWireframeVersion(previous).revision+1;version.updatedAt=next.updatedAt;}
    syncSelectedVersion(next);
    next = validateProject(next);
    this.db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify(next),next.id);
    this.snapshot(next,label); this.recordEntityVersions(next);
    return next;
  }
  assertFlowContext(project:Project,flowVersionId?:string) {
    this.assertFlowAvailable(project,flowVersionId||project.selectedFlowVersionId!);
    const multiple=project.flowGroups.reduce((count,group)=>count+group.versions.length,0)>1;
    assert(flowVersionId||!multiple,'FLOW_CONTEXT_REQUIRED','플로우 버전 정보가 필요합니다. 최신 화면을 불러와 주세요.',409);
    assert(!flowVersionId||flowVersionId===project.selectedFlowVersionId,'FLOW_CONTEXT_CONFLICT','선택한 플로우 버전이 바뀌었습니다. 작업을 시작한 버전으로 돌아가 다시 시도해 주세요.',409);
  }
  assertWireframeContext(project:Project,flowVersionId?:string,wireframeVersionId?:string){
    this.assertFlowContext(project,flowVersionId);
    this.assertWireframeAvailable(project,flowVersionId||project.selectedFlowVersionId!,wireframeVersionId||project.selectedWireframeVersionId!);
    assert(wireframeVersionId||selectedVersion(project).wireframeVersions.length<=1,'WIREFRAME_CONTEXT_REQUIRED','와이어프레임 버전 정보가 필요합니다. 최신 화면을 불러와 주세요.',409);
    assert(!wireframeVersionId||wireframeVersionId===project.selectedWireframeVersionId,'WIREFRAME_CONTEXT_CONFLICT','선택한 와이어프레임 버전이 바뀌었습니다. 작업을 시작한 화면 버전으로 돌아가 다시 시도해 주세요.',409);
  }
  saveArtifact(id: string, artifact: Artifact, expectedRevision: number, value: Project[Artifact], label: string,flowVersionId?:string,wireframeVersionId?:string) {
    return this.transaction(() => {
      const previous = this.project(id);
      assert(!previous.archivedAt,'PROJECT_ARCHIVED','휴지통의 프로젝트는 먼저 복원해 주세요.',409);
      if(artifact==='flow'||artifact==='wireframes')this.assertFlowContext(previous,flowVersionId);
      if(artifact==='wireframes')this.assertWireframeContext(previous,flowVersionId,wireframeVersionId);
      assert(previous.artifactRevisions[artifact] === expectedRevision,'REVISION_CONFLICT','다른 편집 내용이 저장되었습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.',409);
      const next = structuredClone(previous); Object.assign(next,{[artifact]:artifact==='wireframes'?syncNavigation(previous.wireframes,value as WireScreen[]):value});
      const validated = validateProject(next);
      if (equal(previous[artifact],validated[artifact])) return previous;
      return this.commit(previous,validated,label,[artifact]);
    });
  }
  snapshot(project: Project, label: string) {
    const stamp = now();
    this.db.prepare('INSERT INTO revisions(id,project_id,revision,created_at,label,data) VALUES(?,?,?,?,?,?)').run(uid(),project.id,project.revision,stamp,label.slice(0,200),JSON.stringify(project));
    this.audit(project.id,label,{revision:project.revision});
  }
  audit(projectId: string, action: string, details: unknown) {
    this.db.prepare('INSERT INTO audit(id,project_id,created_at,action,details) VALUES(?,?,?,?,?)').run(uid(),projectId,now(),action,JSON.stringify(details));
  }
  revisions(projectId: string): Revision[] {
    this.project(projectId);
    return this.db.prepare('SELECT id,project_id,revision,created_at,label FROM revisions WHERE project_id=? ORDER BY revision DESC').all(projectId).map(row => ({id:row.id as string,projectId:row.project_id as string,revision:row.revision as number,createdAt:row.created_at as string,label:row.label as string}));
  }
  revisionSnapshot(projectId: string, revisionId: string): Project {
    this.project(projectId);
    const row = this.db.prepare('SELECT data FROM revisions WHERE id=? AND project_id=?').get(revisionId, projectId);
    assert(row, 'NOT_FOUND', '미리 볼 버전을 찾을 수 없습니다.', 404);
    // Normalize historical documents in memory; preview must never commit or migrate stored data.
    return validateProject(JSON.parse(row.data as string));
  }
  restore(projectId: string, revisionId: string, expectedRevision: number) {
    return this.transaction(() => {
      const previous = this.project(projectId);
      assert(previous.revision === expectedRevision,'REVISION_CONFLICT','프로젝트가 변경되었습니다. 최신 내용을 확인해 주세요.',409);
      const row = this.db.prepare('SELECT data FROM revisions WHERE id=? AND project_id=?').get(revisionId,projectId);
      assert(row,'NOT_FOUND','복원할 버전을 찾을 수 없습니다.',404);
      const snapshot = validateProject(JSON.parse(row.data as string));
      const restored = {...snapshot,flowGroups:structuredClone(previous.flowGroups),createdAt:previous.createdAt,revision:previous.revision,artifactRevisions:{...previous.artifactRevisions}};
      const historical=selectedVersion(snapshot);const group=restored.flowGroups.find(group=>group.id===historical.groupId&&!group.archivedAt)||restored.flowGroups.find(group=>!group.archivedAt&&group.versions.some(version=>version.id===previous.selectedFlowVersionId))!;
      const version:FlowVersion={...structuredClone(historical),id:uid(),groupId:group.id,name:`문서 버전 ${snapshot.revision} 복원`,number:Math.max(...group.versions.map(version=>version.number))+1,createdAt:now(),updatedAt:now(),archivedAt:null,revision:0};
      const wireframe=initialWireframeVersion(version.id,historical.wireframes,historical.wireframeRevision);version.wireframeVersions=[wireframe];version.selectedWireframeVersionId=wireframe.id;
      group.versions.push(version);restored.selectedFlowVersionId=version.id;
      const projected=projectWithVersion(restored,version.id);
      // Whole-project restore adds a separate visual version; independent saved versions remain available.
      return this.commit(previous,projected,`버전 ${snapshot.revision} 복원`,['prd','features']);
    });
  }
  highWater(projectId: string, artifact: Artifact, id: string) {
    return (this.db.prepare('SELECT revision FROM entity_versions WHERE project_id=? AND artifact=? AND entity_id=?').get(projectId,artifact,id)?.revision as number) || 0;
  }
  recordEntityVersions(p: Project) {
    const statement = this.db.prepare('INSERT INTO entity_versions(project_id,artifact,entity_id,revision) VALUES(?,?,?,?) ON CONFLICT(project_id,artifact,entity_id) DO UPDATE SET revision=MAX(revision,excluded.revision)');
    for (const artifact of ['prd','features'] as const) for (const item of p[artifact]) statement.run(p.id,artifact,item.id,item.revision);
    for(const group of p.flowGroups)for(const version of group.versions)for(const wireframe of version.wireframeVersions)for(const item of wireframe.wireframes)statement.run(p.id,'wireframes',item.id,item.revision);
  }
  private checkProjectRevision(project:Project,expectedRevision:number){assert(project.revision===expectedRevision,'REVISION_CONFLICT','프로젝트가 변경되었습니다. 최신 내용을 불러와 주세요.',409);assert(!project.archivedAt,'PROJECT_ARCHIVED','휴지통의 프로젝트는 먼저 복원해 주세요.',409);}
  private assertFlowAvailable(project:Project,versionId:string){
    const group=project.flowGroups.find(group=>group.versions.some(version=>version.id===versionId));const version=group?.versions.find(version=>version.id===versionId);
    assert(group&&version,'FLOW_VERSION_NOT_FOUND','플로우 버전이 없습니다.',404);assert(!group.archivedAt&&!version.archivedAt,'VERSION_ARCHIVED','보관된 플로우 그룹 또는 버전입니다. 먼저 복원해 주세요.',409);return version;
  }
  private assertWireframeAvailable(project:Project,flowVersionId:string,wireframeVersionId:string){
    const flow=this.assertFlowAvailable(project,flowVersionId);const version=flow.wireframeVersions.find(version=>version.id===wireframeVersionId);
    assert(version,'WIREFRAME_VERSION_NOT_FOUND','와이어프레임 버전이 없습니다.',404);assert(!version.archivedAt,'VERSION_ARCHIVED','보관된 화면 버전입니다. 먼저 복원해 주세요.',409);return version;
  }
  private buildVersion(project:Project,groupId:string,name:string,number:number,sourceVersionId?:string):FlowVersion{
    const source=sourceVersionId?project.flowGroups.flatMap(group=>group.versions).find(version=>version.id===sourceVersionId):null;
    assert(!sourceVersionId||source,'FLOW_VERSION_NOT_FOUND','복사할 플로우 버전이 없습니다.',404);
    if(sourceVersionId)this.assertFlowAvailable(project,sourceVersionId);
    const timestamp=now(),id=uid();
    const wireframeVersions=source?source.wireframeVersions.filter(version=>!version.archivedAt).map(version=>({...structuredClone(version),id:uid(),flowVersionId:id,archivedAt:null})): [initialWireframeVersion(id)];
    const selected=source?wireframeVersions[source.wireframeVersions.filter(version=>!version.archivedAt).findIndex(version=>version.id===source.selectedWireframeVersionId)]||wireframeVersions[0]:wireframeVersions[0];
    return {id,groupId,name,number,createdAt:timestamp,updatedAt:timestamp,archivedAt:null,revision:0,flowRevision:source?.flowRevision||0,wireframeRevision:selected.wireframeRevision,flow:source?structuredClone(source.flow):{nodes:[],edges:[],sections:[]},wireframes:structuredClone(selected.wireframes),wireframeVersions,selectedWireframeVersionId:selected.id};
  }
  createFlowGroup(projectId:string,name:string,expectedRevision:number,sourceVersionId?:string){
    return this.transaction(()=>{const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);const next=structuredClone(previous);const group:FlowGroup={id:uid(),name,createdAt:now(),archivedAt:null,versions:[]};group.versions.push(this.buildVersion(previous,group.id,'첫 번째 버전',1,sourceVersionId));next.flowGroups.push(group);return this.commit(previous,projectWithVersion(next,group.versions[0].id),'플로우 그룹 생성',[]);});
  }
  createFlowVersion(projectId:string,groupId:string,name:string|undefined,expectedRevision:number,sourceVersionId?:string){
    return this.transaction(()=>{const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);const next=structuredClone(previous);const group=next.flowGroups.find(group=>group.id===groupId);assert(group,'FLOW_GROUP_NOT_FOUND','플로우 그룹이 없습니다.',404);assert(!group.archivedAt,'VERSION_ARCHIVED','보관된 플로우 그룹입니다. 먼저 복원해 주세요.',409);const number=Math.max(...group.versions.map(version=>version.number))+1;const version=this.buildVersion(previous,group.id,name||`버전 ${number}`,number,sourceVersionId);group.versions.push(version);return this.commit(previous,projectWithVersion(next,version.id),sourceVersionId?'플로우 버전 복제':'플로우 버전 생성',[]);});
  }
  // Called inside AI approval's transaction so creation and proposal resolution commit together.
  commitGeneratedFlow(previous:Project,flow:FlowDocument,mode:Exclude<FlowGenerationMode,'edit'>,summary:string){
    const next=structuredClone(previous);const origin=selectedVersion(previous);
    const group:FlowGroup=mode==='new-group'?{id:uid(),name:summary.trim().split('\n')[0].slice(0,120)||'AI 새 플로우',createdAt:now(),archivedAt:null,versions:[]}:next.flowGroups.find(group=>group.id===origin.groupId)!;
    if(mode==='new-group')next.flowGroups.push(group);
    const number=group.versions.length?Math.max(...group.versions.map(version=>version.number))+1:1;
    const version=this.buildVersion(previous,group.id,mode==='new-group'?'첫 번째 버전':`AI 수정본 ${number}`,number);
    version.flow=structuredClone(flow);version.flowRevision=1;version.revision=1;
    group.versions.push(version);
    return this.commit(previous,projectWithVersion(next,version.id),mode==='new-group'?'AI 새 플로우 승인':'AI 새 플로우 버전 승인',[]);
  }
  selectFlowVersion(projectId:string,versionId:string,expectedRevision:number){
    return this.transaction(()=>{const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);this.assertFlowAvailable(previous,versionId);if(previous.selectedFlowVersionId===versionId)return previous;return this.commit(previous,projectWithVersion(previous,versionId),'플로우 버전 선택',[]);});
  }
  renameFlow(projectId:string,kind:'group'|'version',id:string,name:string,expectedRevision:number){
    return this.transaction(()=>{const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);const next=structuredClone(previous);const target=kind==='group'?next.flowGroups.find(group=>group.id===id):next.flowGroups.flatMap(group=>group.versions).find(version=>version.id===id);assert(target,'FLOW_VERSION_NOT_FOUND','플로우 그룹 또는 버전이 없습니다.',404);target.name=name;if(kind==='version'){(target as FlowVersion).updatedAt=now();(target as FlowVersion).revision++;}return this.commit(previous,next,'플로우 이름 변경',[]);});
  }
  createWireframeVersion(projectId:string,flowVersionId:string,expectedRevision:number,name?:string,sourceWireframeVersionId?:string){
    return this.transaction(()=>{const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);this.assertFlowAvailable(previous,flowVersionId);const next=structuredClone(previous);const flow=next.flowGroups.flatMap(group=>group.versions).find(version=>version.id===flowVersionId)!;
      const source=sourceWireframeVersionId?flow.wireframeVersions.find(version=>version.id===sourceWireframeVersionId):null;assert(!sourceWireframeVersionId||source,'WIREFRAME_VERSION_NOT_FOUND','복사할 와이어프레임 버전이 없습니다.',404);
      if(sourceWireframeVersionId)this.assertWireframeAvailable(previous,flowVersionId,sourceWireframeVersionId);
      const version=initialWireframeVersion(flow.id,source?.wireframes||[],source?.wireframeRevision||0);version.number=Math.max(...flow.wireframeVersions.map(item=>item.number))+1;version.name=name||`화면 버전 ${version.number}`;flow.wireframeVersions.push(version);
      return this.commit(previous,projectWithWireframeVersion(next,flow.id,version.id),source?'화면 버전 복제':'화면 버전 생성',[]);
    });
  }
  selectWireframeVersion(projectId:string,flowVersionId:string,wireframeVersionId:string,expectedRevision:number){
    return this.transaction(()=>{const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);this.assertWireframeAvailable(previous,flowVersionId,wireframeVersionId);if(previous.selectedFlowVersionId===flowVersionId&&previous.selectedWireframeVersionId===wireframeVersionId)return previous;return this.commit(previous,projectWithWireframeVersion(previous,flowVersionId,wireframeVersionId),'화면 버전 선택',[]);});
  }
  renameWireframeVersion(projectId:string,flowVersionId:string,wireframeVersionId:string,name:string,expectedRevision:number){
    return this.transaction(()=>{const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);const next=structuredClone(previous);const target=next.flowGroups.flatMap(group=>group.versions).find(version=>version.id===flowVersionId)?.wireframeVersions.find(version=>version.id===wireframeVersionId);assert(target,'WIREFRAME_VERSION_NOT_FOUND','와이어프레임 버전이 없습니다.',404);target.name=name;target.updatedAt=now();target.revision++;return this.commit(previous,next,'화면 버전 이름 변경',[]);});
  }
  // Caller owns the approval transaction, including the result context and idempotency record.
  commitGeneratedWireframes(previous:Project,wireframes:WireScreen[],summary:string){
    const next=structuredClone(previous),flow=selectedVersion(next);const version=initialWireframeVersion(flow.id,syncNavigation(previous.wireframes,wireframes),1);version.number=Math.max(...flow.wireframeVersions.map(item=>item.number))+1;version.name=summary.trim().split('\n')[0].slice(0,120)||`AI 화면 버전 ${version.number}`;version.revision=1;flow.wireframeVersions.push(version);
    return this.commit(previous,projectWithWireframeVersion(next,flow.id,version.id),'AI 화면 버전 승인',[]);
  }
  archiveFlow(projectId:string,kind:'group'|'version',targetId:string,archived:boolean,expectedRevision:number){
    return this.transaction(()=>{
      const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);let next=structuredClone(previous);
      const group=kind==='group'?next.flowGroups.find(group=>group.id===targetId):next.flowGroups.find(group=>group.versions.some(version=>version.id===targetId));
      assert(group,'FLOW_GROUP_NOT_FOUND','플로우 그룹이 없습니다.',404);
      const target=kind==='group'?group:group.versions.find(version=>version.id===targetId)!;
      if(kind==='version')assert(!group.archivedAt,'VERSION_ARCHIVED','상위 플로우 그룹을 먼저 복원해 주세요.',409);
      if(Boolean(target.archivedAt)===archived)return previous;
      const siblings=kind==='group'?next.flowGroups:group.versions;
      if(archived)assert(siblings.filter(item=>!item.archivedAt).length>1,'LAST_ACTIVE_VERSION','마지막 활성 그룹 또는 버전은 보관할 수 없습니다.',409);
      target.archivedAt=archived?now():null;
      if(archived&&(kind==='group'?group.versions.some(version=>version.id===next.selectedFlowVersionId):target.id===next.selectedFlowVersionId)){
        const fallbackGroup=kind==='group'?next.flowGroups.filter(item=>!item.archivedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id))[0]:group;
        const fallback=fallbackGroup.versions.filter(item=>!item.archivedAt).sort((a,b)=>b.number-a.number)[0];next=projectWithVersion(next,fallback.id);
      }
      return this.commit(previous,next,`${kind==='group'?'플로우 그룹':'플로우 버전'} ${archived?'보관':'복원'}`,[]);
    });
  }
  archiveWireframeVersion(projectId:string,flowVersionId:string,wireframeVersionId:string,archived:boolean,expectedRevision:number){
    return this.transaction(()=>{
      const previous=this.project(projectId);this.checkProjectRevision(previous,expectedRevision);this.assertFlowAvailable(previous,flowVersionId);let next=structuredClone(previous);
      const flow=next.flowGroups.flatMap(group=>group.versions).find(version=>version.id===flowVersionId)!;const target=flow.wireframeVersions.find(version=>version.id===wireframeVersionId);assert(target,'WIREFRAME_VERSION_NOT_FOUND','와이어프레임 버전이 없습니다.',404);
      if(Boolean(target.archivedAt)===archived)return previous;
      if(archived)assert(flow.wireframeVersions.filter(item=>!item.archivedAt).length>1,'LAST_ACTIVE_VERSION','마지막 활성 화면 버전은 보관할 수 없습니다.',409);
      target.archivedAt=archived?now():null;
      if(archived&&flow.selectedWireframeVersionId===target.id){const fallback=flow.wireframeVersions.filter(item=>!item.archivedAt).sort((a,b)=>b.number-a.number)[0];flow.selectedWireframeVersionId=fallback.id;if(next.selectedFlowVersionId===flow.id)next=projectWithVersion(next,flow.id);}
      return this.commit(previous,next,`화면 버전 ${archived?'보관':'복원'}`,[]);
    });
  }
  putRun(run: AiRun) { this.db.prepare('INSERT INTO runs(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id,run.projectId,JSON.stringify(run)); return run; }
  run(id: string) {
    const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id);
    if (!row) throw new AppError(404,'NOT_FOUND','AI 작업을 찾을 수 없습니다.');
    return JSON.parse(row.data as string) as AiRun;
  }
  putProposal(proposal: Proposal) { this.db.prepare('INSERT INTO proposals(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(proposal.id,proposal.projectId,JSON.stringify(proposal)); return proposal; }
  proposal(id: string) {
    const row = this.db.prepare('SELECT data FROM proposals WHERE id=?').get(id);
    if (!row) throw new AppError(404,'NOT_FOUND','변경 제안을 찾을 수 없습니다.');
    return JSON.parse(row.data as string) as Proposal;
  }
  activity(projectId: string) {
    this.project(projectId);
    const newestFirst=(a:{createdAt:string;id:string},b:{createdAt:string;id:string})=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id);
    const runs = this.db.prepare('SELECT data FROM runs WHERE project_id=?').all(projectId).map(row => JSON.parse(row.data as string) as AiRun).sort(newestFirst).slice(0,50);
    const history = this.db.prepare('SELECT data FROM proposals WHERE project_id=?').all(projectId).map(row => JSON.parse(row.data as string) as Proposal).sort(newestFirst);
    const currentIds=new Set(runs.flatMap(run=>run.proposalId?[run.proposalId]:[]));
    // Retry candidates can outnumber runs. Keep their current review/result even beyond the history window.
    const proposals=history.filter((proposal,index)=>index<100||currentIds.has(proposal.id));
    return {runs,proposals};
  }
}
