import {test} from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../index.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('successful execution queues continuation; interruption disables it', async () => {
 const directory=await mkdtemp(join(tmpdir(),'continuity-test-'));
 await writeFile(join(directory,'tasks.md'),'- [ ] Pending task');
 const storage=new Map(); let tool; let emit; const prompts=[];
 const queue=[]; let wake;
 const ctx={location:{directory},storage:{get:async k=>storage.get(k),set:async(k,v)=>storage.set(k,v)},
 tool:{transform:async callback=>{callback({add:value=>{tool=value;}});return {dispose:async()=>{}};}},
 session:{get:async()=>({directory}),hook:async()=>({dispose:async()=>{}}),prompt:async input=>{prompts.push(input);}},
 event:{subscribe:({signal})=>({async *[Symbol.asyncIterator](){while(!signal.aborted){if(!queue.length)await new Promise(resolve=>{wake=resolve;signal.addEventListener('abort',resolve,{once:true});});while(queue.length)yield queue.shift();}}})}};
 emit=event=>{queue.push(event);wake?.();};
 const cleanup=await plugin.setup(ctx);
 try {
  await tool.execute({action:'enable',path:'tasks.md'},{sessionID:'session'});
  emit({type:'session.execution.succeeded',data:{sessionID:'session'}});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(prompts.length,1);assert.equal(prompts[0].sessionID,'session');
  emit({type:'session.execution.interrupted',data:{sessionID:'session'}});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(storage.get('session:session').enabled,false);
  emit({type:'session.execution.succeeded',data:{sessionID:'session'}});
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(prompts.length,1);
 }finally{await cleanup();await rm(directory,{recursive:true});}
});
