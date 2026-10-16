import { screenSchema } from './schema.js';

function completeValueEnd(text:string,start:number){
  const stack:string[]=[];let quoted=false,escaped=false;
  for(let index=start;index<text.length;index++){
    const char=text[index];
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(char==='{'||char==='['){stack.push(char);if(stack.length>64)return -1;}
    else if(char==='}'||char===']'){
      if(stack.pop()!==(char==='}'?'{':'['))return -1;
      if(!stack.length)return index+1;
    }
  }
  return -1;
}

function documentArrayStart(text:string){
  let depth=0;
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(char==='{'||char==='[')depth++;
    else if(char==='}'||char===']')depth--;
    else if(char==='"'){
      const start=index;let escaped=false,closed=false;
      while(++index<text.length){if(escaped)escaped=false;else if(text[index]==='\\')escaped=true;else if(text[index]==='"'){closed=true;break;}}
      if(!closed)return -1;
      if(depth===1&&text.slice(start,index+1)==='"document"'){
        const match=/^\s*:\s*\[/.exec(text.slice(index+1));
        if(match)return index+1+match[0].length;
      }
    }
  }
  return -1;
}

// A receipt indicator only: complete objects do not mean a valid or approved document.
export function receivedWireframeScreens(output:string):{id:string;name:string}[]{
  const text=output.slice(0,2_000_000).trimStart();
  if(!text.startsWith('{'))return [];
  let cursor=documentArrayStart(text);if(cursor<0)return [];
  const screens:{id:string;name:string}[]=[];
  while(cursor<text.length&&screens.length<100){
    while(/\s/.test(text[cursor]||'')&&cursor<text.length)cursor++;
    if(text[cursor]!=='{')break;
    const end=completeValueEnd(text,cursor);if(end<0)break;
    try{
      const value=JSON.parse(text.slice(cursor,end));
      const queue=Array.isArray(value.elements)?value.elements.map((element:unknown)=>({element,depth:1})):[];
      let bounded=true,count=0;
      while(queue.length){const {element,depth}=queue.pop()!;if(++count>500||depth>8){bounded=false;break;}if(element&&typeof element==='object'&&Array.isArray((element as {children?:unknown}).children))for(const child of (element as {children:unknown[]}).children)queue.push({element:child,depth:depth+1});}
      const parsed=bounded?screenSchema.safeParse(value):null;
      if(parsed?.success&&!screens.some(screen=>screen.id===parsed.data.id))screens.push({id:parsed.data.id,name:parsed.data.name});
    }catch{/* Incomplete or malformed objects are never counted. */}
    cursor=end;while(/\s/.test(text[cursor]||'')&&cursor<text.length)cursor++;
    if(text[cursor]!==',')break;
    cursor++;
  }
  return screens;
}
