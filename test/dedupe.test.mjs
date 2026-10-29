import {test} from 'node:test';
import assert from 'node:assert/strict';
import plugin,{eventIdentity} from '../index.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function harness(storage,directory){
 let tool;const prompts=[];const queue=[];let wake;
 const ctx={location:{directory},storage:{get:async k=>storage.get(k),set:async(k,v)=>storage.set(k,v)},
  tool:{transform:async cb=>{cb({add:v=>{tool=v;}});return{dispose:async()=>{}};}},
  session:{get:async()=>({directory}),hook:async()=>({dispose:async()=>{}}),prompt:async i=>{prompts.push(i);}},
  event:{subscribe:({signal})=>({async *[Symbol.asyncIterator](){while(!signal.aborted){if(!queue.length)await new Promise(r=>{wake=r;signal.addEventListener('abort',r,{once:true});});while(queue.length)yield queue.shift();}}})}};
 const cleanup=await plugin.setup(ctx);
 return{tool,prompts,emit:e=>{queue.push(e);wake?.();},cleanup};
}
const tick=()=>new Promise(r=>setTimeout(r,40));
const success=(id,sessionID='s')=>({id,type:'session.execution.succeeded',data:{sessionID}});

test('eventIdentity prefers id and falls back to durable position',()=>{
 assert.equal(eventIdentity({id:'evt_1'}),'evt_1');
 assert.equal(eventIdentity({durable:{aggregateID:'agg',seq:7}}),'agg:7');
 assert.equal(eventIdentity({data:{}}),null);
});

test('duplicate delivery of the same durable event queues one continuation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'continuity-dedupe-'));
 await writeFile(join(directory,'tasks.md'),'- [ ] One\n- [ ] Two');
 const storage=new Map();const h=await harness(storage,directory);
 try{
  await h.tool.execute({action:'enable',path:'tasks.md'},{sessionID:'s'});
  h.emit(success('evt_1'));await tick();
  assert.equal(h.prompts.length,1);
  h.emit(success('evt_1'));await tick();
  assert.equal(h.prompts.length,1,'replayed event must not queue a second prompt');
 }finally{await h.cleanup();await rm(directory,{recursive:true});}
});

test('replay after plugin restart is suppressed by persisted event identity',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'continuity-replay-'));
 await writeFile(join(directory,'tasks.md'),'- [ ] One');
 const storage=new Map();
 const first=await harness(storage,directory);
 try{
  await first.tool.execute({action:'enable',path:'tasks.md'},{sessionID:'s'});
  first.emit(success('evt_1'));await tick();
  assert.equal(first.prompts.length,1);
 }finally{await first.cleanup();}
 const second=await harness(storage,directory);
 try{
  second.emit(success('evt_1'));await tick();
  assert.equal(second.prompts.length,0,'durable replay after reload must be ignored');
 }finally{await second.cleanup();await rm(directory,{recursive:true});}
});

test('distinct executions still continue and a completed checklist stops',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'continuity-progress-'));
 const file=join(directory,'tasks.md');
 await writeFile(file,'- [ ] One\n- [ ] Two');
 const storage=new Map();const h=await harness(storage,directory);
 try{
  await h.tool.execute({action:'enable',path:'tasks.md'},{sessionID:'s'});
  h.emit(success('evt_1'));await tick();
  assert.equal(h.prompts.length,1);
  h.emit(success('evt_2'));await tick();
  assert.equal(h.prompts.length,2,'a new execution must continue the task');
  await writeFile(file,'- [x] One\n- [x] Two');
  h.emit(success('evt_3'));await tick();
  assert.equal(h.prompts.length,2,'complete checklist must not queue another prompt');
  assert.equal(storage.get('session:s').enabled,false);
  assert.match(storage.get('session:s').reason,/Checklist complete/);
 }finally{await h.cleanup();await rm(directory,{recursive:true});}
});

test('execution.started is ignored and interruption still disables',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'continuity-start-'));
 await writeFile(join(directory,'tasks.md'),'- [ ] One');
 const storage=new Map();const h=await harness(storage,directory);
 try{
  await h.tool.execute({action:'enable',path:'tasks.md'},{sessionID:'s'});
  h.emit({id:'evt_start',type:'session.execution.started',data:{sessionID:'s'}});await tick();
  assert.equal(h.prompts.length,0);
  h.emit({id:'evt_int',type:'session.execution.interrupted',data:{sessionID:'s',reason:'user'}});await tick();
  assert.equal(storage.get('session:s').enabled,false);
  h.emit(success('evt_after'));await tick();
  assert.equal(h.prompts.length,0);
 }finally{await h.cleanup();await rm(directory,{recursive:true});}
});
