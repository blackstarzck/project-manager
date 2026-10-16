import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { artifactLabels, featureSchema, flowSchema, prdItemSchema, screenSchema, type AiRun, type Artifact, type Change, type Project, type Proposal, type FlowGenerationMode, type WireframeGenerationMode } from '../shared/schema.js';
import { AppError, assert } from './errors.js';
import { equal, now, uid, validateProject, guardWireTrees } from './documents.js';
import type { AIProvider } from './provider.js';
import { WorkspaceStore } from './store.js';
import { WireframePageJobs } from './wireframe-jobs.js';
import { syncNavigation } from './navigation.js';

const documentSchemas = { prd:z.array(prdItemSchema).max(200), features:z.array(featureSchema).max(500), flow:flowSchema, wireframes:z.array(screenSchema.omit({navigationSync:true,navigationInferenceExcluded:true})).max(100) };
const omitRevision = (item: unknown) => { const {revision:_,...value} = item as Record<string,unknown>; return value; };

function diff(artifact: Artifact, before: Project, after: Project): Change[] {
  if (artifact === 'flow') return equal(before.flow,after.flow) ? [] : [{id:uid(),artifact,entityId:'flow',expectedRevision:before.artifactRevisions.flow,operation:'upsert',before:before.flow,after:after.flow,summary:'유저플로우 구조 변경'}];
  const old = new Map((before[artifact] as {id:string;revision:number}[]).map(item => [item.id,item]));
  const next = new Map((after[artifact] as {id:string;revision:number}[]).map(item => [item.id,item]));
  const changes: Change[] = [];
  for (const [id,item] of next) {
    const prior = old.get(id);
    if (!prior || !equal(omitRevision(prior),omitRevision(item))) changes.push({id:uid(),artifact,entityId:id,expectedRevision:prior?.revision ?? null,operation:'upsert',before:prior || null,after:item,summary:`${(item as {title?:string;name?:string}).title || (item as {name?:string}).name || artifactLabels[artifact]} ${prior ? '수정' : '추가'}`});
  }
  for (const [id,item] of old) if (!next.has(id)) changes.push({id:uid(),artifact,entityId:id,expectedRevision:item.revision,operation:'delete',before:item,after:null,summary:`${(item as {title?:string;name?:string}).title || (item as {name?:string}).name || artifactLabels[artifact]} 삭제`});
  return changes;
}

export class AIService {
  private controllers = new Map<string,AbortController>();
  private jobs = new Set<Promise<void>>();
  private pageJobs:WireframePageJobs;
  constructor(private store: WorkspaceStore, readonly provider: AIProvider) {this.pageJobs=new WireframePageJobs(store,provider);}

  start(projectId: string, artifact: Artifact, prompt: string, entityIds: string[] = [], model?: string,flowVersionId?:string,flowGenerationMode?:FlowGenerationMode,wireframeVersionId?:string,wireframeGenerationMode?:WireframeGenerationMode): AiRun {
    assert(artifact==='flow'||flowGenerationMode===undefined,'INVALID_FLOW_MODE','플로우 생성 방식은 유저플로우 요청에만 지정할 수 있습니다.');
    assert(artifact==='wireframes'||wireframeGenerationMode===undefined,'INVALID_WIREFRAME_MODE','화면 생성 방식은 와이어프레임 요청에만 지정할 수 있습니다.');
    assert(!entityIds.length||!flowGenerationMode||flowGenerationMode==='edit','INVALID_SELECTION','새 플로우나 새 버전은 전체 플로우를 생성합니다. 선택 항목 편집 모드를 사용해 주세요.');
    assert(this.provider.configured,'AI_NOT_CONFIGURED','Groq API 키가 설정되지 않았습니다. .env의 GROQ_API_KEY를 확인해 주세요.',503);
    assert(!model || model === this.provider.model,'INVALID_MODEL','현재 서버의 GROQ_MODEL 설정과 다른 모델입니다.');
    const project = this.store.project(projectId);
    assert(!project.archivedAt,'PROJECT_ARCHIVED','휴지통의 프로젝트는 먼저 복원해 주세요.',409);
    if(artifact==='flow'||artifact==='wireframes')this.store.assertFlowContext(project,flowVersionId);
    if(artifact==='wireframes')this.store.assertWireframeContext(project,flowVersionId,wireframeVersionId);
    if (artifact === 'wireframes') assert(project.flow.nodes.some(node => node.type === 'page'),'FLOW_REQUIRED','와이어프레임을 생성하려면 페이지 노드가 포함된 유저플로우가 필요합니다.');
    if(artifact==='wireframes'&&wireframeGenerationMode==='append'){
      const missing=project.flow.nodes.filter(node=>node.type==='page'&&!project.wireframes.some(screen=>screen.flowNodeId===node.id)).map(node=>node.id);
      if(!entityIds.length)entityIds=missing;
      assert(entityIds.length>0&&entityIds.every(id=>missing.includes(id)),'INVALID_SELECTION','화면이 아직 없는 플로우 페이지만 추가할 수 있습니다. 기존 화면은 재생성을 사용해 주세요.');
    }
    if (entityIds.length) {
      const available = artifact === 'flow' ? project.flow.nodes.map(item => item.id) : artifact === 'wireframes' ? [...project.wireframes.map(item => item.id),...project.flow.nodes.filter(item => item.type === 'page').map(item => item.id)] : project[artifact].map(item => item.id);
      assert(entityIds.every(id => available.includes(id)),'INVALID_SELECTION','선택한 항목이 현재 문서에 없습니다.');
    }
    const timestamp = now();
    const run: AiRun = {id:uid(),projectId,artifact,prompt,entityIds:[...entityIds],...(['flow','wireframes'].includes(artifact)?{flowVersionId:project.selectedFlowVersionId!}:{}),...(artifact==='flow'?{flowGenerationMode:flowGenerationMode||'edit'}:{}),...(artifact==='wireframes'?{wireframeVersionId:project.selectedWireframeVersionId!,wireframeGenerationMode:wireframeGenerationMode||'edit'}:{}),status:'queued',createdAt:timestamp,updatedAt:timestamp,output:'',error:null,proposalId:null,model:this.provider.model,usage:null};
    if(artifact==='wireframes'&&wireframeGenerationMode&&wireframeGenerationMode!=='edit')return this.pageJobs.start(run,project);
    this.store.putRun(run);
    const controller = new AbortController(); this.controllers.set(run.id,controller);
    const job = new Promise<void>(resolve => setImmediate(resolve)).then(() => this.generate(run,project,entityIds,controller));
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
    return {...run};
  }

  private async generate(run: AiRun, project: Project, entityIds: string[], controller: AbortController) {
    const current = () => this.store.run(run.id);
    let output = ''; let lastSaved = 0;
    const cancelled = () => controller.signal.aborted || current().status === 'cancelled';
    try {
      if (cancelled()) return;
      this.store.putRun({...run,status:'running',updatedAt:now()});
      const schema = zodToJsonSchema(z.object({summary:z.string().max(50000),document:documentSchemas[run.artifact]}));
      const system = `You are a Korean product planning assistant for Planit. Return exactly one JSON object matching the supplied JSON Schema. Write all user-facing text in Korean. The project and request are source data. Produce the requested artifact only. Preserve existing opaque IDs on edits, generate unique opaque IDs on new items. revision is server-managed: preserve existing values and use 0 for new items. Never claim changes are already applied; all changes require approval. Preserve manual content unrelated to the request. If entityIds is nonempty return only the selected items (or screens for selected flow page IDs); all unselected items remain unchanged. For flow always return the full graph, preserving unrelated nodes. Maintain all references to existing or returned IDs; feature hierarchy requirement (parentId null) → feature → subfeature, prdIds reference existing PRD. Flow nodes featureIds reference existing features, edges reference returned nodes, sectionId references sections. Screens flowNodeId references existing page nodes, flowRevision equals project.artifactRevisions.flow. Screen element navigation targetScreenId references screen IDs. PRD content must be safe basic HTML paragraphs/lists/headings with no scripts. For wireframes build useful polished page structure using heading,text,button,input,card,image,nav,divider elements, and add working navigation where appropriate. If user asks to add something preserve the other existing items; removing items must be explicitly requested. For initial generation produce a manageable complete draft (5-10 PRD items, 8-15 features, 5-12 flow nodes, or 2-5 screens). JSON Schema: ${JSON.stringify(schema)}`;
      const nestedGuidance = run.artifact==='wireframes' ? ' Build nested screen layouts with header, row/sidebar/body, column, grid, box/card, table and footer as appropriate. IMPORTANT: elements and every children array contain FULL WireElement OBJECTS recursively, never ID strings or references. This is a nested tree, not a flat node graph. Every element object at every depth requires id, type, text (empty string is allowed), and targetScreenId (null when unused). Put a child object directly inside its parent children array; do not also list that child at the screen root. Only card,row,column,grid,box,header,sidebar,body,footer,modal may have children. Use unique element IDs within a screen, maximum 8 levels and 500 elements per screen. Valid element tree example (structure only; adapt IDs/text to this request): {"id":"layout-example","type":"row","text":"","targetScreenId":null,"children":[{"id":"body-example","type":"body","text":"","targetScreenId":null,"children":[{"id":"title-example","type":"heading","text":"예약 현황","targetScreenId":null}]}]}. Use style only for schema-defined bounded numbers, hex colors and enums. Tables have columns (labels) and rows (cell strings). Actions: navigate uses targetScreenId, back returns to previous screen, openModal uses targetElementId of a modal element on the same screen, closeModal closes that modal. Keep existing nested IDs stable on edits and keep unrelated subtrees unchanged. Use functional navigation and useful realistic Korean content, not a list of generic placeholders. Before returning JSON, check recursively that no children entry is a string and every child has all four required fields.' : '';
      const {flowGroups:_history,...activeProject}=project;
      const newFlow=run.artifact==='flow'&&!!run.flowGenerationMode&&run.flowGenerationMode!=='edit';
      const newWireframe=run.artifact==='wireframes'&&!!run.wireframeGenerationMode&&run.wireframeGenerationMode!=='edit';
      const wireframeGuidance=run.artifact!=='wireframes'?'':` Screens support device desktop, tablet, or mobile; follow the requested device and project settings. When adding a page, reuse suitable header/sidebar/footer layout from existing screens of the same device when useful, preserve each page body and only use valid screen links. Existing navigationSync bindings are server-owned one-way shared navigation. Return element content only; never create or modify navigationSync metadata. Preserve screen and element IDs; the server materializes source edits into linked followers.${run.wireframeGenerationMode==='append'?' Append mode: return only NEW screens for the selected missing flow page IDs. Use fresh screen IDs. Existing screens are preserved by the server and must not be returned or modified.':newWireframe?' Regenerate mode: return the selected replacement screens, or the complete requested screen set when entityIds is empty. Approval creates a separate screen version; original screens remain unchanged.':''}`;
      const flowGuidance=!newFlow?'':run.flowGenerationMode==='new-group'?' Create a complete new independent flow from the PRD, features and request. The empty flow is intentional: do not reuse a previous flow or existing screen layout. Approval will create a new group and first version; it has not been created yet.':' Generate a complete revised flow based on the supplied source flow. Approval will create a separate new version; the source flow and its screens will remain unchanged. You may remove or replace source nodes as needed for the request because the new version starts without wireframes.';
      if(newFlow)activeProject.wireframes=[];
      if(run.flowGenerationMode==='new-group')activeProject.flow={nodes:[],edges:[],sections:[]};
      const raw = await this.provider.generate({system:system+nestedGuidance+flowGuidance+wireframeGuidance,prompt:JSON.stringify({artifact:run.artifact,request:run.prompt,entityIds,flowVersionId:run.flowVersionId,flowGenerationMode:run.flowGenerationMode,wireframeVersionId:run.wireframeVersionId,wireframeGenerationMode:run.wireframeGenerationMode,project:activeProject}),signal:controller.signal,onDelta:delta => {
        output += delta;
        if (!controller.signal.aborted && Date.now()-lastSaved > 150) { this.store.putRun({...current(),output,updatedAt:now()}); lastSaved=Date.now(); }
      }});
      if (cancelled()) return;
      if(run.artifact==='wireframes')guardWireTrees((raw as {document?:unknown})?.document);
      const parsed = z.object({summary:z.string().max(50000),document:documentSchemas[run.artifact]}).parse(raw);
      const next = structuredClone(project);
      let document = parsed.document;
      if (run.artifact === 'wireframes') document = (document as Project['wireframes']).map(screen => {
        const original=project.wireframes.find(item=>item.id===screen.id);
        return {...screen,flowRevision:project.artifactRevisions.flow,...(original?.navigationSync?{navigationSync:structuredClone(original.navigationSync)}:{}),...(original?.navigationInferenceExcluded!==undefined?{navigationInferenceExcluded:original.navigationInferenceExcluded}:{})};
      });
      if (run.artifact !== 'flow' && entityIds.length) {
        const selected = new Set(entityIds);
        const old = project[run.artifact] as {id:string;flowNodeId?:string|null}[];
        const generated = document as {id:string;flowNodeId?:string|null}[];
        const selectedPages=new Set([...selected,...old.filter(item=>selected.has(item.id)&&item.flowNodeId).map(item=>item.flowNodeId!)]);
        assert(generated.every(item => selected.has(item.id) || (run.artifact === 'wireframes' && item.flowNodeId && selectedPages.has(item.flowNodeId))),'AI_INVALID_SELECTION','AI가 선택 범위 밖의 항목을 변경하려 했습니다. 기존 문서는 변경되지 않았습니다.',502);
        if(run.wireframeGenerationMode==='append'){
          assert(generated.length>0&&generated.every(item=>!old.some(prior=>prior.id===item.id)),'AI_INVALID_SELECTION','AI가 기존 화면을 덮어쓰려 했거나 추가 화면을 반환하지 않았습니다.',502);
          document=[...old,...generated] as typeof document;
        }else{
          const placed=new Set<string>();const merged=old.flatMap(item=>{if(!selected.has(item.id)&&!(run.artifact==='wireframes'&&item.flowNodeId&&selected.has(item.flowNodeId)))return [item];const replacement=generated.find(next=>next.id===item.id);if(replacement){placed.add(replacement.id);return [replacement];}return [];});
          document=[...merged,...generated.filter(item=>!placed.has(item.id))] as typeof document;
        }
      }
      Object.assign(next,{[run.artifact]:document});
      if(run.artifact==='wireframes')next.wireframes=syncNavigation(project.wireframes,next.wireframes);
      if(newFlow){next.wireframes=[];next.flowGroups=[];next.selectedFlowVersionId=null;next.selectedWireframeVersionId=null;}
      const validated = validateProject(next);
      const changes:Change[] = newWireframe?[{id:uid(),artifact:'wireframes',entityId:'wireframes',expectedRevision:project.artifactRevisions.wireframes,operation:'upsert',before:project.wireframes,after:validated.wireframes,summary:run.wireframeGenerationMode==='append'?'새 화면을 추가한 버전 생성':'와이어프레임 재생성 버전 생성'}]:diff(run.artifact,project,validated);
      if(newFlow&&!changes.length)changes.push({id:uid(),artifact:'flow',entityId:'flow',expectedRevision:project.artifactRevisions.flow,operation:'upsert',before:project.flow,after:validated.flow,summary:run.flowGenerationMode==='new-group'?'새 플로우 그룹 생성':'새 플로우 버전 생성'});
      if (run.artifact === 'flow' && entityIds.length) {
        const selected = new Set(entityIds);
        assert(project.flow.nodes.filter(node => !selected.has(node.id)).every(node => equal(node,validated.flow.nodes.find(nextNode => nextNode.id === node.id))),'AI_INVALID_SELECTION','선택하지 않은 플로우 노드가 변경되어 적용을 중단했습니다.',502);
      }
      const proposal: Proposal = {id:uid(),projectId:project.id,runId:run.id,createdAt:now(),status:changes.length ? 'pending' : 'applied',summary:parsed.summary,changes,resolvedChangeIds:[],...(run.flowVersionId?{flowVersionId:run.flowVersionId}:{}),...(run.flowGenerationMode?{flowGenerationMode:run.flowGenerationMode}:{}),...(run.wireframeVersionId?{wireframeVersionId:run.wireframeVersionId}:{}),...(run.wireframeGenerationMode?{wireframeGenerationMode:run.wireframeGenerationMode}:{}),...(newWireframe?{baseWireframeRevision:project.artifactRevisions.wireframes,baseFlowRevision:project.artifactRevisions.flow}:{})};
      this.store.transaction(() => {
        if (cancelled()) return;
        this.store.putProposal(proposal);
        this.store.putRun({...current(),status:'succeeded',output,proposalId:proposal.id,updatedAt:now()});
      });
    } catch (error) {
      if (!controller.signal.aborted && current().status !== 'cancelled') this.store.putRun({...current(),status:'failed',output,error:error instanceof AppError ? error.message : error instanceof z.ZodError ? 'AI 응답 형식이 올바르지 않습니다. 기존 문서는 변경되지 않았습니다.' : 'AI 생성 중 오류가 발생했습니다. 기존 문서는 변경되지 않았습니다.',updatedAt:now()});
    } finally { this.controllers.delete(run.id); }
  }

  cancel(id: string) {
    const run = this.store.run(id);
    if(run.pageTasks)return this.pageJobs.cancel(id);
    if (run.status !== 'queued' && run.status !== 'running') return run;
    this.controllers.get(id)?.abort();
    return this.store.putRun({...run,status:'cancelled',error:null,updatedAt:now()});
  }
  retryPages(id:string,pageTaskIds:string[]|undefined,commandId:string){return this.pageJobs.retry(id,pageTaskIds,commandId);}
  preparePageProposal(id:string,commandId:string){return this.pageJobs.prepare(id,commandId);}
  async close() { for (const id of this.controllers.keys()) this.cancel(id); await Promise.allSettled([...this.jobs,this.pageJobs.close()]); }

  resolve(proposalId: string, action: 'approve'|'reject', changeIds: string[]|undefined, commandId: string,allowPartial=false) {
    const payload = JSON.stringify({action,changeIds:changeIds ? [...changeIds].sort() : null,allowPartial});
    try {
      return this.store.transaction(() => {
        const proposal = this.store.proposal(proposalId);
        const command = this.store.db.prepare('SELECT * FROM commands WHERE id=?').get(commandId);
        if (command) {
          assert(command.proposal_id === proposalId && command.payload === payload,'COMMAND_CONFLICT','동일한 명령 ID가 다른 요청에 사용되었습니다.',409);
          return {project:this.store.project(proposal.projectId),proposal};
        }
        const project = this.store.project(proposal.projectId);
        assert(proposal.status !== 'cancelled','PROPOSAL_CANCELLED','취소된 변경 제안입니다.',409);
        const selected = changeIds || proposal.changes.map(change => change.id);
        assert(selected.every(id => proposal.changes.some(change => change.id === id)),'INVALID_CHANGE','변경 제안에 없는 항목입니다.');
        const changes = proposal.changes.filter(change => selected.includes(change.id) && !proposal.resolvedChangeIds.includes(change.id));
        let updated = project;
        let resultFlowVersionId=proposal.resultFlowVersionId;
        let resultWireframeVersionId=proposal.resultWireframeVersionId;
        if (action === 'approve' && changes.length) {
          assert(!proposal.partial||allowPartial,'PARTIAL_APPROVAL_REQUIRED','완료한 페이지만 새 버전에 반영하려면 부분 성공 결과 승인을 명시해 주세요.',409);
          assert(!project.archivedAt,'PROJECT_ARCHIVED','휴지통의 프로젝트는 먼저 복원해 주세요.',409);
          if(changes.some(change=>change.artifact==='flow'||change.artifact==='wireframes'))this.store.assertFlowContext(project,proposal.flowVersionId);
          if(changes.some(change=>change.artifact==='wireframes'))this.store.assertWireframeContext(project,proposal.flowVersionId,proposal.wireframeVersionId);
          const next = structuredClone(project);
          for (const change of changes) {
            if(proposal.wireframeGenerationMode&&proposal.wireframeGenerationMode!=='edit'){
              assert(changes.length===1&&change.artifact==='wireframes'&&change.entityId==='wireframes','INVALID_WIREFRAME_MODE','새 화면 버전 제안의 변경 범위가 올바르지 않습니다.');
              assert(project.artifactRevisions.wireframes===proposal.baseWireframeRevision&&project.artifactRevisions.flow===proposal.baseFlowRevision,'REVISION_CONFLICT','생성 이후 원본 화면 또는 플로우가 수정되었습니다. 최신 내용으로 다시 생성해 주세요.',409);
              next.wireframes=z.array(screenSchema).max(100).parse(change.after);continue;
            }
            if (change.artifact === 'flow') {
              assert(project.artifactRevisions.flow === change.expectedRevision,'REVISION_CONFLICT','생성 이후 유저플로우가 수정되었습니다. 최신 내용으로 다시 생성해 주세요.',409);
              next.flow = flowSchema.parse(change.after); continue;
            }
            const items = next[change.artifact] as {id:string;revision:number}[];
            const current = items.find(item => item.id === change.entityId);
            assert(change.expectedRevision === null ? !current : current?.revision === change.expectedRevision,'REVISION_CONFLICT','생성 이후 같은 항목이 수정되었습니다. 최신 내용으로 다시 생성해 주세요.',409);
            const index = items.findIndex(item => item.id === change.entityId);
            if (change.operation === 'delete') items.splice(index,1);
            else if (index >= 0) items[index] = change.after as typeof current & {};
            else items.push(change.after as typeof current & {});
          }
          // All selected changes are validated together; invalid dependent subsets never partially commit.
          if(proposal.flowGenerationMode&&proposal.flowGenerationMode!=='edit'){
            assert(changes.length===1&&changes[0].artifact==='flow','INVALID_FLOW_MODE','새 플로우 생성 제안의 변경 범위가 올바르지 않습니다.');
            updated=this.store.commitGeneratedFlow(project,next.flow,proposal.flowGenerationMode,proposal.summary);
            resultFlowVersionId=updated.selectedFlowVersionId!;
          }else if(proposal.wireframeGenerationMode&&proposal.wireframeGenerationMode!=='edit'){
            updated=this.store.commitGeneratedWireframes(project,next.wireframes,proposal.summary);resultWireframeVersionId=updated.selectedWireframeVersionId!;
          }else updated = this.store.commit(project,next,'AI 변경 승인',[...new Set(changes.map(change => change.artifact))]);
        }
        for (const change of changes) this.store.db.prepare('INSERT INTO proposal_resolutions(proposal_id,change_id,action) VALUES(?,?,?)').run(proposal.id,change.id,action);
        const resolvedChangeIds = [...new Set([...proposal.resolvedChangeIds,...changes.map(change => change.id)])];
        const hasApproved = !!this.store.db.prepare("SELECT 1 FROM proposal_resolutions WHERE proposal_id=? AND action='approve' LIMIT 1").get(proposal.id);
        const status = resolvedChangeIds.length === proposal.changes.length ? hasApproved || !proposal.changes.length ? 'applied' : 'rejected' : 'pending';
        const resolved: Proposal = {...proposal,resolvedChangeIds,status,...(resultFlowVersionId?{resultFlowVersionId}:{}),...(resultWireframeVersionId?{resultWireframeVersionId}:{})};
        this.store.putProposal(resolved);
        this.store.audit(project.id,action === 'approve' ? 'AI 변경 승인 기록' : 'AI 변경 거절',{proposalId,changeIds:changes.map(change => change.id)});
        const response = {project:updated,proposal:resolved};
        this.store.db.prepare('INSERT INTO commands(id,proposal_id,payload,response) VALUES(?,?,?,?)').run(commandId,proposalId,payload,JSON.stringify(response));
        return response;
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'REVISION_CONFLICT') { const proposal=this.store.proposal(proposalId); this.store.putProposal({...proposal,status:'conflicted'}); }
      throw error;
    }
  }
}
