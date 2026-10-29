import { Plugin } from '@opencode/plugin';
import { readFile, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { taskPath, inspect, advance } from './policy.mjs';

const TYPES = [
  'session.execution.started',
  'session.execution.succeeded',
  'session.execution.interrupted',
  'session.execution.failed',
  'session.tool.called',
];

const SEEN_LIMIT = 256;
const OWNER = Symbol.for('notyetdone.owner');

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
    const previous = globalThis[OWNER];
    if (previous) await previous.dispose().catch(() => {});

    const registrations = [];
    const controller = new AbortController();
    let disposed = false;
    const owner = {
      async dispose() {
        if (disposed) return;
        disposed = true;
        controller.abort();
        for (const registration of registrations) await registration.dispose();
        if (globalThis[OWNER] === owner) globalThis[OWNER] = null;
      },
    };
    globalThis[OWNER] = owner;

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

    // The platform client exposes session.inbox.cancel, but the plugin context
    // only types a subset of the session API. Detect the method instead of
    // assuming it: if it is missing, the prompt stays marked as cancelled and
    // status reports why the revocation did not happen.
    const canRevoke = () => typeof ctx.session?.inbox?.cancel === 'function';

    async function cancelPending(sessionID, state) {
      if (!state?.pendingPrompt) return state;
      const pending = {...state.pendingPrompt, cancelled: true, cancelledAt: new Date().toISOString()};
      let result;
      if (!canRevoke()) result = {ok: false, reason: 'session.inbox.cancel unavailable'};
      else if (!pending.inboxID) result = {ok: false, reason: 'inbox id unknown'};
      else {
        try {
          await ctx.session.inbox.cancel({sessionID, inboxID: pending.inboxID});
          result = {ok: true};
        } catch (error) {
          result = {ok: false, reason: error.message};
        }
      }
      return {...state, pendingPrompt: {...pending, cancelResult: {...result, at: new Date().toISOString()}}};
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
            state = {enabled:true,path:input.path,directory:session.directory ?? session.location?.directory ?? ctx.location.directory,runs:0,unchanged:0,toolEvents:0,idleTools:0,lastEventID:null,lastQueuedAt:0,history:[],ownerToken:crypto.randomUUID(),createdAt:new Date().toISOString()};
            await report(state);
          } else if (input.action === 'pause' || input.action === 'block') {
            if (input.action === 'block' && !input.reason?.trim()) throw new Error('Describe the external blocker');
            state = {...state, enabled:false, reason:input.reason ?? 'Paused by request'};
            if (state.pendingPrompt) state = await cancelPending(sessionID, state);
          }
          if (state) await ctx.storage.set(key(sessionID),state);
          if (!state) return {content:JSON.stringify({enabled:false,revoke:{available:canRevoke()}})};
          const checklist = await report(state).catch(error=>({error:error.message}));
          return {content:JSON.stringify({...state,checklist,instance:{token:state.ownerToken ?? null,active:globalThis[OWNER] === owner,pid:process.pid},revoke:{available:canRevoke()}})};
        }
      });
    }));

    registrations.push(await ctx.session.hook('prompt', async event => {
      if (event.metadata?.taskContinuity) return;
      const text = event.prompt.text.trim();
      const paused = /^(?:стоп|остановись|пауза|stop|pause)(?:\s|[.!]|$)/i.test(text);
      if (paused) {
        const state = await ctx.storage.get(key(event.sessionID));
        if (state) {
          const next = {...state, enabled:false, reason:'User requested stop'};
          await ctx.storage.set(key(event.sessionID), state.pendingPrompt ? await cancelPending(event.sessionID, next) : next);
        }
      }
      const command = /^\/continuity\s+(on|off|status)(?:\s+(.+))?$/i.exec(text);
      if (command) event.prompt.text = `Use task_continuity now: action=${command[1]==='on'?'enable':command[1]==='off'?'pause':'status'}${command[2]?`, path=${command[2]}`:''}. Then continue the user's active task if enabling. Do not change task scope.`;
      // Any explicit interruption is handled by execution.interrupted below.
    }));

    void (async () => {
      for await (const event of ctx.event.subscribe({signal:controller.signal,types:TYPES})) {
        const sessionID = event.data?.sessionID;
        if (!sessionID) continue;
        const identity = eventIdentity(event);

        // A new execution consumes the queued continuation.
        if (event.type === 'session.execution.started') {
          const state = await ctx.storage.get(key(sessionID));
          if (state?.pendingPrompt) await ctx.storage.set(key(sessionID),{...state,pendingPrompt:null,lastStartedEventID:identity ?? state.lastStartedEventID});
          continue;
        }

        // Count one event per tool invocation; deltas and progress are noisy.
        if (event.type === 'session.tool.called') {
          const state = await ctx.storage.get(key(sessionID));
          if (state?.enabled) await ctx.storage.set(key(sessionID),{...state,toolEvents:(state.toolEvents ?? 0) + 1,lastToolAt:new Date().toISOString()});
          continue;
        }

        if (busy.has(sessionID)) continue;
        // In-memory replay guard: the same durable event must never act twice.
        if (identity && seen.has(identity)) continue;

        busy.add(sessionID);
        try {
          let state = await ctx.storage.get(key(sessionID));
          if (!state?.enabled) continue;
          // Persisted replay guard: survives plugin reload and stream resume.
          if (identity && state.lastEventID === identity) continue;
          // A claim for this exact event means a prompt was already queued.
          if (identity && state.pendingPrompt?.eventID === identity) continue;
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

          // Claim the prompt before queueing it. A replay or a racing delivery
          // sees the claim in storage and stops instead of queueing again.
          const claim = {eventID: identity ?? state.lastEventID, token: crypto.randomUUID(), queuedAt: Date.now()};
          state = {...state, lastQueuedAt: Date.now(), pendingPrompt: claim};
          await ctx.storage.set(key(sessionID),state);
          const queued = await ctx.session.prompt({sessionID,text:`Continue the authorized active task using ${state.path}. Unchecked tasks remain. Read current task/evidence and implement the next unfinished requirement, verify it, then update its checkbox only when acceptance passes. Do not ask for continuation. Respect user exclusions and stop instructions. If every checkbox in ${state.path} is already checked, do not start new work: state in one line that the task is complete and stop. If genuinely blocked externally, use task_continuity action=block with a specific reason. A complete checklist is not proof of test acceptance.`,metadata:{taskContinuity:true},delivery:'queue'});
          if (queued?.id) {
            // Keep a pause that landed while the prompt was being queued: if the
            // claim was already cancelled, cancel the now-known inbox item too.
            const latest = await ctx.storage.get(key(sessionID));
            if (latest?.pendingPrompt?.token === claim.token) {
              const withID = {...latest, pendingPrompt: {...latest.pendingPrompt, inboxID: queued.id}};
              await ctx.storage.set(key(sessionID), withID.pendingPrompt.cancelled ? await cancelPending(sessionID, withID) : withID);
            }
          }
        } catch (error) {
          const latest = await ctx.storage.get(key(sessionID)).catch(() => null);
          await ctx.storage.set(key(sessionID),{...latest,enabled:false,reason:`Continuation error: ${error.message}`});
        } finally { busy.delete(sessionID); }
      }
    })().catch(() => {});
    return owner.dispose;
  }
});
