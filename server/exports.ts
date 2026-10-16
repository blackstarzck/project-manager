import ExcelJS from 'exceljs';
import sanitizeHtml from 'sanitize-html';
import { sectionLabels, type Project, type WireScreen, type WireElement } from '../shared/schema.js';
import { escapeHtml, wireElements, selectedVersion, selectedWireframeVersion } from './documents.js';

const plain = (html: string) => sanitizeHtml(html.replace(/<\/(?:p|h[1-6]|li|blockquote)>/gi,'\n').replace(/<br\s*\/?>/gi,'\n'),{allowedTags:[],allowedAttributes:{}}).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();

export function markdown(project: Project) {
  const lines = [`# ${project.name}`,'',project.description,'',`> 문서 버전 ${project.revision} · ${project.updatedAt}`,'','## PRD',''];
  for (const [section,label] of Object.entries(sectionLabels)) {
    lines.push(`### ${label}`,'');
    for (const item of project.prd.filter(item => item.section === section)) lines.push(`#### ${item.title}`,'',plain(item.content),'');
  }
  lines.push('## 기능명세','');
  const visit = (parentId: string|null, depth: number) => {
    for (const feature of project.features.filter(item => item.parentId === parentId)) {
      lines.push(`${'#'.repeat(Math.min(6,depth+3))} ${feature.title}`,'',feature.description,'',`- 유형: ${feature.kind} / 우선순위: ${feature.priority} / 상태: ${feature.status}`,`- 역할: ${feature.roles.join(', ') || '미지정'}`);
      if (feature.acceptanceCriteria.length) lines.push('- 수용 기준:',...feature.acceptanceCriteria.map(item => `  - ${item}`));
      lines.push(''); visit(feature.id,depth+1);
    }
  }; visit(null,0);
  return lines.join('\n');
}

export function mermaid(project: Project) {
  const ids = new Map(project.flow.nodes.map((node,index) => [node.id,`n${index}`]));
  const label = (text: string) => text.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/[\r\n]/g,' ').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'&#124;').replace(/\[/g,'&#91;').replace(/\]/g,'&#93;').replace(/\{/g,'&#123;').replace(/\}/g,'&#125;');
  const lines = ['flowchart TD'];
  for (const node of project.flow.nodes) {
    const title = label(node.label);
    lines.push(`  ${ids.get(node.id)}${node.type === 'decision' ? `{"${title}"}` : node.type === 'start' ? `(["${title}"])` : `["${title}"]`}`);
  }
  for (const edge of project.flow.edges) lines.push(`  ${ids.get(edge.source)} -->${edge.label ? `|"${label(edge.label)}"|` : ''} ${ids.get(edge.target)}`);
  return lines.join('\n')+'\n';
}

export async function xlsx(project: Project) {
  const workbook = new ExcelJS.Workbook(); workbook.creator='Planit'; workbook.created=new Date();
  const sheet=workbook.addWorksheet('기능명세');
  sheet.columns=[{header:'ID',key:'id',width:38},{header:'상위 ID',key:'parentId',width:38},{header:'유형',key:'kind',width:16},{header:'기능',key:'title',width:32},{header:'설명',key:'description',width:60},{header:'우선순위',key:'priority',width:14},{header:'상태',key:'status',width:16},{header:'역할',key:'roles',width:24},{header:'수용 기준',key:'acceptanceCriteria',width:60},{header:'PRD 연결',key:'prdIds',width:38}];
  for (const item of project.features) sheet.addRow({...item,roles:item.roles.join(', '),acceptanceCriteria:item.acceptanceCriteria.join('\n'),prdIds:item.prdIds.join(', ')});
  const prd=workbook.addWorksheet('PRD'); prd.columns=[{header:'섹션',key:'section',width:24},{header:'제목',key:'title',width:32},{header:'내용',key:'content',width:100}];
  for (const item of project.prd) prd.addRow({...item,section:sectionLabels[item.section],content:plain(item.content)});
  const meta=workbook.addWorksheet('프로젝트'); meta.addRows([['프로젝트',project.name],['설명',project.description],['버전',project.revision],['저장 시각',project.updatedAt]]); meta.columns=[{width:20},{width:100}];
  for (const tab of [sheet,prd]) { tab.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};tab.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF6554E8'}};tab.views=[{state:'frozen',ySplit:1}];tab.eachRow(row=>{row.alignment={vertical:'top',wrapText:true};}); }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function inlineStyle(element:WireElement){
  const style=element.style;if(!style)return '';
  const entries:string[]=[];
  for(const key of ['gap','padding','width','height','fontSize'] as const)if(style[key]!==undefined)entries.push(`${key==='fontSize'?'font-size':key}:${style[key]}px`);
  if(style.background)entries.push(`background:${style.background}`);if(style.color)entries.push(`color:${style.color}`);
  if(style.align)entries.push(`align-items:${{start:'flex-start',center:'center',end:'flex-end',stretch:'stretch'}[style.align]}`);
  if(style.justify)entries.push(`justify-content:${{start:'flex-start',center:'center',end:'flex-end',between:'space-between'}[style.justify]}`);
  if(element.type==='grid')entries.push(`grid-template-columns:repeat(${style.columns||2},minmax(0,1fr))`);
  return entries.length?` style="${escapeHtml(entries.join(';'))}"`:'';
}
function renderScreen(screen: WireScreen, links: Map<string,string>,screenIndex:number) {
  const elementIds=new Map(wireElements(screen.elements).map((element,index)=>[element.id,`screen-${screenIndex+1}-element-${index+1}`]));
  const render=(element:WireElement):string=>{
    const text=escapeHtml(element.text);const target=element.targetScreenId?links.get(element.targetScreenId):null;
    const action=element.action||(target?'navigate':null);
    const attributes=`id="${elementIds.get(element.id)}" class="wf-${element.type}"${inlineStyle(element)}`;
    const nested=element.children?.map(render).join('\n')||'';
    const actionAttributes=action?` data-action="${action}"${action==='navigate'&&target?` data-target="${target}"`:''}${element.targetElementId?` data-modal="${elementIds.get(element.targetElementId)}"`:''}`:'';
    switch(element.type){
      case 'heading':return `<h2 ${attributes}>${text}</h2>${nested}`;
      case 'text':return `<p ${attributes}>${text.replace(/\n/g,'<br>')}</p>${nested}`;
      case 'button':return action==='navigate'&&target?`<a ${attributes} href="#${target}"${actionAttributes}>${text}</a>${nested}`:`<button ${attributes} type="button"${actionAttributes}>${text}</button>${nested}`;
      case 'nav':return `<nav ${attributes}>${action==='navigate'&&target?`<a href="#${target}" class="wf-nav-link"${actionAttributes}>${text}</a>`:action?`<button type="button" class="wf-nav-link"${actionAttributes}>${text}</button>`:text}${nested}</nav>`;
      case 'input':return `<label ${attributes}>${text}<input placeholder="${text}"></label>${nested}`;
      case 'image':return `<div ${attributes} role="img" aria-label="${text}"><span>◇</span><small>${text}</small></div>${nested}`;
      case 'divider':return `<hr ${attributes}>`;
      case 'spacer':return `<div ${attributes} aria-hidden="true"></div>`;
      case 'table':return `<div ${attributes}>${text?`<h3>${text}</h3>`:''}<table>${element.columns?.length?`<thead><tr>${element.columns.map(value=>`<th>${escapeHtml(value)}</th>`).join('')}</tr></thead>`:''}<tbody>${(element.rows||[]).map(row=>`<tr>${row.map(value=>`<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>${nested}</div>`;
      case 'modal':return `<dialog ${attributes}>${text?`<h2>${text}</h2>`:''}${nested}<button type="button" class="wf-modal-default-close" data-action="closeModal">닫기</button></dialog>`;
      default:{const tag=element.type==='header'?'header':element.type==='footer'?'footer':element.type==='sidebar'?'aside':'div';return `<${tag} ${attributes}>${text?`<div class="wf-container-label">${text.replace(/\n/g,'<br>')}</div>`:''}${nested}</${tag}>`;}
    }
  };
  return screen.elements.map(render).join('\n');
}
export function html(project: Project) {
  const links=new Map(project.wireframes.map((screen,index)=>[screen.id,`screen-${index+1}`]));
  const nav=project.wireframes.map(screen=>`<a href="#${links.get(screen.id)}">${escapeHtml(screen.name)}</a>`).join('');
  const pages=project.wireframes.map((screen,index)=>`<section class="screen ${screen.device}" id="${links.get(screen.id)}" aria-label="${escapeHtml(screen.name)}"><header class="screen-label">${escapeHtml(screen.name)}</header><div class="content">${renderScreen(screen,links,index)}</div></section>`).join('\n');
  const version=selectedVersion(project),wireframeVersion=selectedWireframeVersion(project);
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><title>${escapeHtml(project.name)} — 와이어프레임</title><style>*{box-sizing:border-box}body{margin:0;color:#2e2c2a;background:#f6f5f3;font:15px system-ui,sans-serif}body>header{background:#fff;padding:16px 24px;border-bottom:1px solid #d9d6d2;display:flex;gap:24px;align-items:center;flex-wrap:wrap}body>header nav{display:flex;gap:14px;flex-wrap:wrap}a{color:#6554e8}main{padding:32px}.screen{display:none;background:#fff;width:1440px;max-width:100%;min-height:900px;margin:auto;border:1px solid #d9d6d2;border-radius:8px;overflow:hidden;box-shadow:0 8px 40px #24213b0a}.screen.active{display:block}.screen.mobile{width:390px;min-height:844px}.screen.tablet{width:768px;min-height:1024px}.screen-label{padding:18px 28px;border-bottom:1px solid #e8e6e3;font-weight:700}.content{padding:24px;min-height:800px}.content h2{font-size:28px;margin:0 0 16px}.content p{line-height:1.8;color:inherit;white-space:normal;margin:0 0 12px}.content input{display:block;border:1px solid #d9d6d2;padding:12px 16px;border-radius:6px;margin-top:8px;width:100%;font:inherit}.content button,.content .wf-button{display:inline-block;text-decoration:none;padding:12px 22px;border:0;border-radius:6px;background:#2e2c2a;color:#fff;font:inherit;cursor:pointer}.content label{display:block;font-size:13px}.wf-row{display:flex;flex-direction:row;gap:16px;align-items:stretch}.wf-column,.wf-body,.wf-box,.wf-card{display:flex;flex-direction:column;gap:12px}.wf-body{flex:1;min-width:0}.wf-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.wf-card,.wf-box{border:1px solid #d9d6d2;border-radius:8px;padding:20px}.wf-header{display:flex;align-items:center;gap:20px;min-height:56px;border-bottom:1px solid #e8e6e3;padding:12px 20px}.wf-sidebar{display:flex;flex-direction:column;gap:16px;width:240px;flex:none;padding:20px 16px;background:#f6f5f3;border-right:1px solid #e8e6e3}.wf-footer{padding:20px;border-top:1px solid #e8e6e3;color:#8f8a85}.wf-container-label{font-weight:600}.wf-image{height:170px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:#ecebe8;border-radius:8px;color:#8f8a85}.wf-image span{font-size:30px}.wf-nav{display:flex;gap:12px;align-items:center}.content .wf-nav-link{background:transparent;color:inherit;padding:8px 4px;text-align:left}.wf-divider{border:0;border-top:1px solid #e8e6e3;width:100%;margin:16px 0}.wf-spacer{height:24px;flex:none}.wf-table{overflow:auto}.wf-table table{border-collapse:collapse;width:100%;font-size:14px}.wf-table th,.wf-table td{border:1px solid #e8e6e3;padding:12px;text-align:left}.wf-table th{background:#f6f5f3}.wf-modal{border:1px solid #d9d6d2;border-radius:10px;padding:28px;max-width:min(640px,90vw);min-width:280px;color:#2e2c2a;box-shadow:0 24px 80px #0003}.wf-modal::backdrop{background:#0006}.wf-modal-default-close{margin-top:20px}body>footer{text-align:center;color:#8f8a85;padding:24px;font-size:12px}</style></head><body><header><strong>${escapeHtml(project.name)}</strong><nav>${nav}</nav></header><main>${pages || '<p>아직 생성된 화면이 없습니다.</p>'}</main><footer>Planit · 문서 버전 ${project.revision} · ${escapeHtml(version.name)} (v${version.number}) · ${escapeHtml(wireframeVersion.name)} (v${wireframeVersion.number}) · 오프라인 와이어프레임</footer><script>(()=>{const pages=[...document.querySelectorAll('.screen')],stack=[];function show(record=true){const id=location.hash.slice(1),active=pages.find(page=>page.id===id)||pages[0];if(!active)return;for(const page of pages)page.classList.toggle('active',page===active);for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();if(record&&stack.at(-1)!==active.id)stack.push(active.id)}addEventListener('hashchange',()=>show());document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;if(action==='navigate'&&button.dataset.target)location.hash=button.dataset.target;else if(action==='back'&&stack.length>1){stack.pop();const id=stack.at(-1);history.replaceState(null,'','#'+id);show(false)}else if(action==='openModal'){const dialog=document.getElementById(button.dataset.modal);if(dialog&&dialog.tagName==='DIALOG'&&!dialog.open)dialog.showModal()}else if(action==='closeModal'){const dialog=button.dataset.modal?document.getElementById(button.dataset.modal):button.closest('dialog');if(dialog&&dialog.tagName==='DIALOG')dialog.close()}});show()})();</script></body></html>`;
}

