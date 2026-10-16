import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { artifactSchema, artifactLabels, flowGenerationModeSchema, wireframeGenerationModeSchema, projectSchema, settingsSchema, type AiStatus, type Project } from '../shared/schema.js';
import { AIService } from './ai.js';
import { AppError, assert } from './errors.js';
import { cloneProject, newProject, now, validateProject, projectWithVersion, projectWithWireframeVersion } from './documents.js';
import { WorkspaceStore } from './store.js';
import { GroqProvider, type AIProvider } from './provider.js';
import * as exports from './exports.js';

export interface AppOptions { dbPath?: string; provider?: AIProvider; allowedOrigins?: string[]; staticDirectory?: string; logger?: boolean }
const paramsId = z.object({id:z.string().min(1).max(120)});
export async function createApp(options: AppOptions = {}) {
  const filename = options.dbPath || ':memory:';
  if (filename !== ':memory:') mkdirSync(path.dirname(filename),{recursive:true});
  const store = new WorkspaceStore(filename);
  const provider = options.provider || new GroqProvider();
  const ai = new AIService(store,provider);
  const app = Fastify({logger:options.logger ?? false,bodyLimit:20*1024*1024});
  const allowedOrigins = new Set(options.allowedOrigins || ['http://127.0.0.1:3100','http://localhost:3100','http://127.0.0.1:5173','http://localhost:5173']);
  const allowedHosts = new Set([...allowedOrigins].map(origin=>new URL(origin).host));
  allowedHosts.add('localhost:80'); // Fastify inject's default test host; actual requests still bind loopback.
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('X-Frame-Options','DENY');
    if (!request.url.startsWith('/api')) return;
    const host=request.headers.host || '';
    assert(allowedHosts.has(host),'INVALID_HOST','허용되지 않은 호스트입니다.',403);
    const origin=request.headers.origin;
    assert(!origin || allowedOrigins.has(origin),'INVALID_ORIGIN','허용되지 않은 요청 출처입니다.',403);
    assert(request.headers['sec-fetch-site'] !== 'cross-site','INVALID_ORIGIN','외부 사이트 요청은 허용되지 않습니다.',403);
    reply.header('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
      assert(request.headers['x-requested-with'] === 'ProjectManager','INVALID_REQUEST','앱에서 전송한 요청만 허용됩니다.',403);
      assert(request.headers['content-type']?.split(';')[0].trim() === 'application/json','INVALID_CONTENT_TYPE','JSON 요청이 필요합니다.',415);
    }
  });
  app.setErrorHandler((error,_request,reply)=>{
    if (error instanceof z.ZodError) return reply.status(400).send({error:'입력 형식이 올바르지 않습니다.',code:'VALIDATION_ERROR'});
    if (error instanceof AppError) return reply.status(error.statusCode).send({error:error.message,code:error.code});
    const candidate = (error as {statusCode?:number}).statusCode;
    const status=typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : 500;
    return reply.status(status).send({error:status === 500 ? '작업을 처리하지 못했습니다. 다시 시도해 주세요.' : '요청 형식이 올바르지 않습니다.',code:status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST'});
  });
  app.get('/api/health',async()=>({ok:true}));
  app.get('/api/ai/status',async():Promise<AiStatus>=>({provider:'groq',configured:provider.configured,model:provider.model,models:[provider.model]}));
  app.get('/api/projects',async request=>store.list((request.query as {archived?:string}).archived === 'true'));
  app.post('/api/projects',async(request,reply)=>{
    const body=z.object({name:z.string().trim().min(1).max(120),description:z.string().max(5000).optional()}).parse(request.body);
    return reply.status(201).send(store.insert(newProject(body.name,body.description)));
  });
  app.get('/api/projects/:id',async request=>store.project(paramsId.parse(request.params).id));
  app.patch('/api/projects/:id',async request=>{
    const {id}=paramsId.parse(request.params);
    const body=z.object({name:z.string().trim().min(1).max(120).optional(),description:z.string().max(5000).optional(),archived:z.boolean().optional(),settings:settingsSchema.optional(),expectedRevision:z.number().int().nonnegative()}).parse(request.body);
    return store.transaction(()=>{const old=store.project(id);assert(old.revision===body.expectedRevision,'REVISION_CONFLICT','프로젝트가 변경되었습니다. 최신 내용을 불러와 주세요.',409);const next={...old,...(body.name!==undefined?{name:body.name}:{}),...(body.description!==undefined?{description:body.description}:{}),...(body.settings?{settings:body.settings}:{}),...(body.archived!==undefined?{archivedAt:body.archived?now():null}:{})};return store.commit(old,next,body.archived===true?'휴지통으로 이동':body.archived===false?'프로젝트 복원':'프로젝트 설정 변경',[]);});
  });
  app.post('/api/projects/:id/duplicate',async(request,reply)=>reply.status(201).send(store.insert(cloneProject(store.project(paramsId.parse(request.params).id)),'프로젝트 복제')));
  app.put('/api/projects/:id/artifacts/:artifact',async request=>{
    const {id,artifact}=paramsId.extend({artifact:artifactSchema}).parse(request.params);
    const body=z.object({expectedRevision:z.number().int().nonnegative(),value:z.unknown(),label:z.string().max(200).optional(),flowVersionId:z.string().min(1).max(120).optional(),wireframeVersionId:z.string().min(1).max(120).optional()}).parse(request.body);
    return store.saveArtifact(id,artifact,body.expectedRevision,body.value as Project[typeof artifact],body.label || `${artifactLabels[artifact]} 편집`,body.flowVersionId,body.wireframeVersionId);
  });
  app.get('/api/projects/:id/activity',async request=>store.activity(paramsId.parse(request.params).id));
  app.post('/api/projects/:id/ai/runs',async(request,reply)=>{
    const {id}=paramsId.parse(request.params);
    const body=z.object({artifact:artifactSchema,prompt:z.string().trim().min(1).max(20000),entityIds:z.array(z.string().min(1).max(120)).max(300).optional(),model:z.string().max(120).optional(),flowVersionId:z.string().min(1).max(120).optional(),flowGenerationMode:flowGenerationModeSchema.optional(),wireframeVersionId:z.string().min(1).max(120).optional(),wireframeGenerationMode:wireframeGenerationModeSchema.optional()}).parse(request.body);
    return reply.status(202).send(ai.start(id,body.artifact,body.prompt,body.entityIds,body.model,body.flowVersionId,body.flowGenerationMode,body.wireframeVersionId,body.wireframeGenerationMode));
  });
  app.get('/api/ai/runs/:id',async request=>store.run(paramsId.parse(request.params).id));
  app.post('/api/ai/runs/:id/cancel',async request=>ai.cancel(paramsId.parse(request.params).id));
  app.post('/api/ai/runs/:id/retry-pages',async(request,reply)=>{const {id}=paramsId.parse(request.params);const body=z.object({pageTaskIds:z.array(z.string().min(1).max(120)).min(1).max(100).optional(),commandId:z.string().min(1).max(120)}).parse(request.body);return reply.status(202).send(ai.retryPages(id,body.pageTaskIds,body.commandId));});
  app.post('/api/ai/runs/:id/prepare-proposal',async request=>{const {id}=paramsId.parse(request.params);const body=z.object({commandId:z.string().min(1).max(120)}).parse(request.body);return ai.preparePageProposal(id,body.commandId);});
  app.post('/api/proposals/:id/resolve',async request=>{
    const {id}=paramsId.parse(request.params);
    const body=z.object({action:z.enum(['approve','reject']),changeIds:z.array(z.string().min(1).max(120)).max(1000).optional(),commandId:z.string().min(1).max(120),allowPartial:z.boolean().optional()}).parse(request.body);
    return ai.resolve(id,body.action,body.changeIds,body.commandId,body.allowPartial);
  });
  app.get('/api/projects/:id/revisions',async request=>store.revisions(paramsId.parse(request.params).id));
  app.get('/api/projects/:id/revisions/:revisionId',async request=>{
    const {id,revisionId}=paramsId.extend({revisionId:z.string().min(1).max(120)}).parse(request.params);
    return store.revisionSnapshot(id,revisionId);
  });
  app.get('/api/projects/:id/flow-groups',async request=>store.project(paramsId.parse(request.params).id).flowGroups);
  app.post('/api/projects/:id/flow-groups',async(request,reply)=>{
    const {id}=paramsId.parse(request.params);const body=z.object({name:z.string().trim().min(1).max(120),expectedRevision:z.number().int().nonnegative(),sourceVersionId:z.string().min(1).max(120).optional()}).parse(request.body);
    return reply.status(201).send(store.createFlowGroup(id,body.name,body.expectedRevision,body.sourceVersionId));
  });
  app.post('/api/projects/:id/flow-groups/:groupId/versions',async(request,reply)=>{
    const {id,groupId}=paramsId.extend({groupId:z.string().min(1).max(120)}).parse(request.params);const body=z.object({name:z.string().trim().min(1).max(120).optional(),expectedRevision:z.number().int().nonnegative(),sourceVersionId:z.string().min(1).max(120).optional()}).parse(request.body);
    return reply.status(201).send(store.createFlowVersion(id,groupId,body.name,body.expectedRevision,body.sourceVersionId));
  });
  app.post('/api/projects/:id/flow-versions/:versionId/select',async request=>{
    const {id,versionId}=paramsId.extend({versionId:z.string().min(1).max(120)}).parse(request.params);const body=z.object({expectedRevision:z.number().int().nonnegative()}).parse(request.body);return store.selectFlowVersion(id,versionId,body.expectedRevision);
  });
  for(const kind of ['group','version'] as const)app.patch(`/api/projects/:id/flow-${kind}s/:targetId`,async request=>{
    const {id,targetId}=paramsId.extend({targetId:z.string().min(1).max(120)}).parse(request.params);const body=z.object({name:z.string().trim().min(1).max(120),expectedRevision:z.number().int().nonnegative()}).parse(request.body);return store.renameFlow(id,kind,targetId,body.name,body.expectedRevision);
  });
  for(const kind of ['group','version'] as const)for(const action of ['archive','restore'] as const)app.post(`/api/projects/:id/flow-${kind}s/:targetId/${action}`,async request=>{
    const {id,targetId}=paramsId.extend({targetId:z.string().min(1).max(120)}).parse(request.params);const body=z.object({expectedRevision:z.number().int().nonnegative()}).parse(request.body);return store.archiveFlow(id,kind,targetId,action==='archive',body.expectedRevision);
  });
  const wireframePath='/api/projects/:id/flow-versions/:flowVersionId/wireframe-versions';
  const wireframeParams=paramsId.extend({flowVersionId:z.string().min(1).max(120)});
  const targetWireframeParams=wireframeParams.extend({wireframeVersionId:z.string().min(1).max(120)});
  app.get(wireframePath,async request=>{const {id,flowVersionId}=wireframeParams.parse(request.params);const flow=store.project(id).flowGroups.flatMap(group=>group.versions).find(version=>version.id===flowVersionId);assert(flow,'FLOW_VERSION_NOT_FOUND','플로우 버전이 없습니다.',404);return flow.wireframeVersions;});
  app.post(wireframePath,async(request,reply)=>{const {id,flowVersionId}=wireframeParams.parse(request.params);const body=z.object({expectedRevision:z.number().int().nonnegative(),name:z.string().trim().min(1).max(120).optional(),sourceWireframeVersionId:z.string().min(1).max(120).optional()}).parse(request.body);return reply.status(201).send(store.createWireframeVersion(id,flowVersionId,body.expectedRevision,body.name,body.sourceWireframeVersionId));});
  app.post(`${wireframePath}/:wireframeVersionId/select`,async request=>{const {id,flowVersionId,wireframeVersionId}=targetWireframeParams.parse(request.params);const body=z.object({expectedRevision:z.number().int().nonnegative()}).parse(request.body);return store.selectWireframeVersion(id,flowVersionId,wireframeVersionId,body.expectedRevision);});
  app.patch(`${wireframePath}/:wireframeVersionId`,async request=>{const {id,flowVersionId,wireframeVersionId}=targetWireframeParams.parse(request.params);const body=z.object({expectedRevision:z.number().int().nonnegative(),name:z.string().trim().min(1).max(120)}).parse(request.body);return store.renameWireframeVersion(id,flowVersionId,wireframeVersionId,body.name,body.expectedRevision);});
  for(const action of ['archive','restore'] as const)app.post(`${wireframePath}/:wireframeVersionId/${action}`,async request=>{const {id,flowVersionId,wireframeVersionId}=targetWireframeParams.parse(request.params);const body=z.object({expectedRevision:z.number().int().nonnegative()}).parse(request.body);return store.archiveWireframeVersion(id,flowVersionId,wireframeVersionId,action==='archive',body.expectedRevision);});
  app.post('/api/projects/:id/revisions/:revisionId/restore',async request=>{
    const {id,revisionId}=paramsId.extend({revisionId:z.string().min(1).max(120)}).parse(request.params);
    const {expectedRevision}=z.object({expectedRevision:z.number().int().nonnegative()}).parse(request.body);
    return store.restore(id,revisionId,expectedRevision);
  });
  app.get('/api/projects/:id/backup',async(request,reply)=>{
    const project=store.project(paramsId.parse(request.params).id);
    return reply.header('Content-Disposition',`attachment; filename="planit-backup-${project.id}.json"`).send({format:'planit-backup',version:1,project});
  });
  app.post('/api/backups/restore',async(request,reply)=>{
    const body=z.object({format:z.literal('planit-backup'),version:z.literal(1),project:z.unknown()}).parse(request.body);
    const p=validateProject(body.project);
    return reply.status(201).send(store.insert(cloneProject(p,`${p.name} 복원본`),'백업에서 복원'));
  });
  app.get('/api/projects/:id/export',async(request,reply)=>{
    let project=store.project(paramsId.parse(request.params).id);
    const {format,flowVersionId,wireframeVersionId}=z.object({format:z.enum(['markdown','xlsx','mermaid','html']),flowVersionId:z.string().min(1).max(120).optional(),wireframeVersionId:z.string().min(1).max(120).optional()}).parse(request.query);
    if(flowVersionId)project=projectWithVersion(project,flowVersionId);
    if(wireframeVersionId)project=projectWithWireframeVersion(project,project.selectedFlowVersionId!,wireframeVersionId);
    const extensions={markdown:'md',xlsx:'xlsx',mermaid:'mmd',html:'html'};
    const contentTypes={markdown:'text/markdown; charset=utf-8',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',mermaid:'text/plain; charset=utf-8',html:'text/html; charset=utf-8'};
    const content=format==='xlsx'?await exports.xlsx(project):exports[format](project);
    return reply.type(contentTypes[format]).header('Content-Disposition',`attachment; filename="planit-r${project.revision}.${extensions[format]}"; filename*=UTF-8''${encodeURIComponent(project.name)}.${extensions[format]}`).send(content);
  });
  if (options.staticDirectory && existsSync(options.staticDirectory)) {
    await app.register(fastifyStatic,{root:path.resolve(options.staticDirectory),prefix:'/'});
    app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/') ? reply.status(404).send({error:'요청한 경로가 없습니다.',code:'NOT_FOUND'}) : reply.sendFile('index.html'));
  }
  app.addHook('onClose',async()=>{await ai.close();store.close();});
  return app;
}
