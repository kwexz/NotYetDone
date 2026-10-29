import { Plugin } from '@opencode/plugin';
import { readFile, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { taskPath, inspect, advance } from './policy.mjs';

const TYPES = [
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.interrupted',
  'session.execution.failed',
];

const SEEN_LIMIT = 256;

// Event.ID is authoritative. `durable` (aggregateID + seq) is the fallback for
// events delivered without a top-level id. Returns null when neither exists.
export function eventIdentity(event) {
  if (typeof event?.id === 'string' && event.id) return event.id;
  const durable = event?.durable;
  if (durable && durable.aggregateID != null && durable.seq != null) return `${durable.aggregateID}:${durable.seq}`;
  return null;
}

export default Plugin.define({
  id: 'task-continuity',
  async setup(ctx) {
    const registrations = [];
    const busy = new Set();
    const seen = new Set();
    const key = id => `session:${id}`;

    async function report(state) {
      const root = await realpath(state.directory);
      const path = await realpath(taskPath(root, state.path));
      const rel = relative(root, path);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Task symlink escapes project');
      return inspect(await readFile(path, 'utf8'));
    }

    function remember(identity) {
      if (!identity) return;
      seen.add(identity);
      if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
    }

    registrations.push(await ctx.tool.transform(editor => {
      editor.add({
        name: 'task_continuity',
        description: 'Manage automatic continuation in this interactive session. Enable only when user requests ongoing execution. action: enable/pause/status/block. path is a project-relative Markdown checklist. block requires a concrete external blocker. Do not mark incomplete requirements complete to stop continuation.',
        input: { type:'object', properties:{action:{type:'string',enum:['enable','pause','status','block']},path:{type:'string'},reason:{type:'string'}},required:['action'],additionalProperties:false },
        execute: async (input, context) => {
          const sessionID = context.sessionID;
          let state = await ctx.storage.get(key(sessionID));
          if (input.action === 'enable') {
            const session = await ctx.session.get({sessionID});
            state = {enabled:true,path:input.path,directory:session.directory ?? session.location?.directory ?? ctx.location.directory,runs:0,unchanged:0,lastEventID:null,lastQueuedAt:0,history:[]};
            await report(state);
          } else if (input.action === 'pause' || input.action === 'block') {
            if (input.action === 'block' && !input.reason?.trim()) throw new Error('Describe the external blocker');
            state = {...state,enabled:false,reason:input.reason ?? 'Paused by request'};
          }
          if (state) await ctx.storage.set(key(sessionID),state);
          return {content:JSON.stringify(state ? {...state,checklist:await report(state).catch(error=>({error:error.message}))} : {enabled:false})};
        }
      });
    }));

    registrations.push(await ctx.session.hook('prompt', async event => {
      if (event.metadata?.taskContinuity) return;
      const text = event.prompt.text.trim();
      const paused = /^(?:стоп|остановись|пауза|stop|pause)(?:\s|[.!]|$)/i.test(text);
      if (paused) {
        const state = await ctx.storage.get(key(event.sessionID));
        if (state) await ctx.storage.set(key(event.sessionID), {...state, enabled:false, reason:'User requested stop'});
      }
      const command = /^\/continuity\s+(on|off|status)(?:\s+(.+))?$/i.exec(text);
      if (command) event.prompt.text = `Use task_continuity now: action=${command[1]==='on'?'enable':command[1]==='off'?'pause':'status'}${command[2]?`, path=${command[2]}`:''}. Then continue the user's active task if enabling. Do not change task scope.`;
      // Any explicit interruption is handled by execution.interrupted below.
    }));

    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({signal:controller.signal,types:TYPES})) {
        const sessionID = event.data?.sessionID;
        if (!sessionID) continue;
        const identity = eventIdentity(event);

        // A new execution consumes any queued continuation; nothing to do here.
        if (event.type === 'session.execution.started') continue;

        if (busy.has(sessionID)) continue;
        // In-memory replay guard: the same durable event must never act twice.
        if (identity && seen.has(identity)) continue;

        busy.add(sessionID);
        try {
          let state = await ctx.storage.get(key(sessionID));
          if (!state?.enabled) continue;
          // Persisted replay guard: survives plugin reload and stream resume.
          if (identity && state.lastEventID === identity) continue;
          remember(identity);

          if (event.type !== 'session.execution.succeeded') {
            await ctx.storage.set(key(sessionID),{...state,enabled:false,lastEventID:identity ?? state.lastEventID,reason:'Execution interrupted or failed; explicit resume required'});
            continue;
          }

          const report_ = await report(state);
          state = {...advance(state,report_), lastEventID:identity ?? state.lastEventID, lastEventAt:new Date().toISOString()};
          state.history = [...(state.history ?? []), {event:identity,type:event.type,pending:report_.pending,digest:report_.digest.slice(0,12),at:state.lastEventAt}].slice(-5);
          await ctx.storage.set(key(sessionID),state);
          if (!state.enabled) continue;

          state = {...state, lastQueuedAt: Date.now()};
          await ctx.storage.set(key(sessionID),state);
          await ctx.session.prompt({sessionID,text:`Continue the authorized active task using ${state.path}. Unchecked tasks remain. Read current task/evidence and implement the next unfinished requirement, verify it, then update its checkbox only when acceptance passes. Do not ask for continuation. Respect user exclusions and stop instructions. If every checkbox in ${state.path} is already checked, do not start new work: state in one line that the task is complete and stop. If genuinely blocked externally, use task_continuity action=block with a specific reason. A complete checklist is not proof of test acceptance.`,metadata:{taskContinuity:true},delivery:'queue'});
        } catch (error) {
          await ctx.storage.set(key(sessionID),{enabled:false,reason:`Continuation error: ${error.message}`});
        } finally { busy.delete(sessionID); }
      }
    })().catch(() => {});
    return async () => { controller.abort(); for (const registration of registrations) await registration.dispose(); };
  }
});
