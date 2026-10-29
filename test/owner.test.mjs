import {test} from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../index.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Unlike the other suites, this context broadcasts every event to every
// subscriber, the way the real runtime does. That is what turns two plugin
// instances into two prompts.
function broadcastCtx(directory, storage, options = {}) {
  const prompts = [];
  const cancelled = [];
  const subs = new Set();
  let tool;
  const ctx = {
    location: {directory},
    storage: {get: async k => storage.get(k), set: async (k, v) => storage.set(k, v)},
    tool: {transform: async cb => { cb({add: v => { tool = v; }}); return {dispose: async () => {}}; }},
    session: {
      get: async () => ({directory}),
      hook: async () => ({dispose: async () => {}}),
      prompt: async input => { prompts.push(input); return typeof options.promptResult === 'function' ? options.promptResult(input) : options.promptResult; },
      ...(options.inbox ? {inbox: {cancel: async input => {
        if (options.cancelError) throw new Error(options.cancelError);
        cancelled.push(input);
      }}} : {}),
    },
    event: {
      subscribe: ({signal}) => {
        const queue = [];
        let wake;
        const sub = {push: event => { queue.push(event); wake?.(); wake = null; }};
        subs.add(sub);
        signal.addEventListener('abort', () => { subs.delete(sub); wake?.(); wake = null; }, {once: true});
        return {
          async *[Symbol.asyncIterator]() {
            while (!signal.aborted) {
              if (!queue.length) await new Promise(resolve => { wake = resolve; signal.addEventListener('abort', resolve, {once: true}); });
              while (queue.length) yield queue.shift();
            }
          },
        };
      },
    },
  };
  return {
    ctx,
    prompts,
    cancelled,
    getTool: () => tool,
    emit: event => { for (const sub of [...subs]) sub.push(event); },
    subscribers: () => subs.size,
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 40));
const waitFor = async (predicate, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for the expected state');
};
const success = (id, sessionID = 's') => ({id, type: 'session.execution.succeeded', data: {sessionID}});

test('a queued prompt is claimed in storage before delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-claim-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action: 'enable', path: 'tasks.md'}, {sessionID: 's'});
    h.emit(success('evt_1'));
    await tick();
    assert.equal(h.prompts.length, 1);
    const claimed = storage.get('session:s').pendingPrompt;
    assert.equal(claimed.eventID, 'evt_1');
    assert.ok(claimed.token, 'claim carries a token');
    h.emit(success('evt_1'));
    await tick();
    assert.equal(h.prompts.length, 1, 'claimed event must not queue twice');
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

test('execution.started clears the claim so the next success continues', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-start-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action: 'enable', path: 'tasks.md'}, {sessionID: 's'});
    h.emit(success('evt_1'));
    await tick();
    assert.equal(h.prompts.length, 1);
    assert.ok(storage.get('session:s').pendingPrompt);
    h.emit({id: 'evt_2', type: 'session.execution.started', data: {sessionID: 's'}});
    await tick();
    assert.equal(storage.get('session:s').pendingPrompt, null);
    h.emit(success('evt_3'));
    await tick();
    assert.equal(h.prompts.length, 2, 'a new execution may continue after started');
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

test('a second setup replaces the first owner and one event yields one prompt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-owner-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One\n- [ ] Two');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const first = await plugin.setup(h.ctx);
  const second = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action: 'enable', path: 'tasks.md'}, {sessionID: 's'});
    h.emit(success('evt_1'));
    await tick();
    assert.equal(h.prompts.length, 1, 'a single event must queue exactly one prompt');
    assert.equal(h.subscribers(), 1, 'only one subscription may stay active');
  } finally {
    await second();
    await first();
    await rm(directory, {recursive: true});
  }
});

test('pause revokes a queued prompt when the runtime exposes inbox.cancel', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-cancel-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage, {inbox: true, promptResult: () => ({id: 'msg_1'})});
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action: 'enable', path: 'tasks.md'}, {sessionID: 's'});
    h.emit(success('evt_1'));
    await tick();
    assert.equal(storage.get('session:s').pendingPrompt.inboxID, 'msg_1');

    const paused = JSON.parse((await h.getTool().execute({action: 'pause'}, {sessionID: 's'})).content);
    assert.equal(paused.enabled, false);
    assert.equal(h.cancelled.length, 1, 'inbox.cancel is called once');
    assert.deepEqual(h.cancelled[0], {sessionID: 's', inboxID: 'msg_1'});
    assert.equal(paused.pendingPrompt.cancelled, true);
    assert.equal(paused.pendingPrompt.cancelResult.ok, true);
    assert.equal(paused.revoke.available, true);
    assert.equal(paused.instance.active, true);

    h.emit(success('evt_2'));
    await tick();
    assert.equal(h.prompts.length, 1, 'a paused session queues nothing new');
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

test('pause marks the prompt cancelled when inbox.cancel is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-nocancel-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage, {promptResult: () => ({id: 'msg_2'})});
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action: 'enable', path: 'tasks.md'}, {sessionID: 's'});
    h.emit(success('evt_1'));
    await tick();

    const paused = JSON.parse((await h.getTool().execute({action: 'pause'}, {sessionID: 's'})).content);
    assert.equal(paused.pendingPrompt.cancelled, true);
    assert.equal(paused.pendingPrompt.cancelResult.ok, false);
    assert.equal(paused.pendingPrompt.cancelResult.reason, 'session.inbox.cancel unavailable');
    assert.equal(paused.revoke.available, false);
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

test('three idle successes stop on stagnation after two prompts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-idle-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action: 'enable', path: 'tasks.md'}, {sessionID: 's'});
    h.emit(success('evt_1'));
    await tick();
    h.emit(success('evt_2'));
    await tick();
    h.emit(success('evt_3'));
    await tick();
    const state = storage.get('session:s');
    assert.equal(h.prompts.length, 2, 'the third run must not queue a prompt');
    assert.equal(state.enabled, false);
    assert.match(state.reason, /Stagnation/);
    assert.equal(state.idleTools, 2);
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

test('tool.called increments the counter and a success resets it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-tools-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action: 'enable', path: 'tasks.md'}, {sessionID: 's'});
    h.emit({id: 'tool_1', type: 'session.tool.called', data: {sessionID: 's', id: 'call_1'}});
    await tick();
    assert.equal(storage.get('session:s').toolEvents, 1);
    h.emit(success('evt_1'));
    await tick();
    const state = storage.get('session:s');
    assert.equal(state.toolEvents, 0);
    assert.equal(state.idleTools, 0);
    assert.equal(state.enabled, true);
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

test('a red check keeps a closed checklist running and ships the output tail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-gate-red-'));
  await writeFile(join(directory, 'tasks.md'), '- [x] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await assert.rejects(
      h.getTool().execute({action: 'pause', check: {file: 'node'}}, {sessionID: 's'}),
      /only accepted with action=enable/,
    );
    await assert.rejects(
      h.getTool().execute({action: 'enable', path: 'tasks.md', check: {file: '../escape.js'}}, {sessionID: 's'}),
      /stay inside the project/,
    );
    await h.getTool().execute({
      action: 'enable',
      path: 'tasks.md',
      check: {file: 'node', args: ['-e', 'console.error("CHECK-FAIL");process.exit(2)']},
    }, {sessionID: 's'});

    h.emit(success('evt_1'));
    await waitFor(() => h.prompts.length === 1);
    const state = storage.get('session:s');
    assert.equal(state.enabled, true, 'a failed check must not stop the loop');
    assert.equal(state.lastCheck.code, 2);
    assert.equal(state.lastCheck.passed, false);
    assert.match(h.prompts[0].text, /CHECK-FAIL/);
    assert.match(h.prompts[0].text, /check still fails/);
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

test('pause during a running check wins over its result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-gate-pause-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action:'enable', path:'tasks.md', check:{file:'node', args:['-e', 'setTimeout(() => process.exit(1), 2000)']}}, {sessionID:'s'});
    h.emit(success('evt_1'));
    await new Promise(resolve => setTimeout(resolve, 200));
    await h.getTool().execute({action:'pause'}, {sessionID:'s'});
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(storage.get('session:s').enabled, false);
    assert.equal(storage.get('session:s').reason, 'Paused by request');
    assert.equal(h.prompts.length, 0);
  } finally {
    await dispose();
    await rm(directory, {recursive:true});
  }
});

test('interrupt is consumed while a check is running and prevents continuation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-gate-interrupt-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action:'enable', path:'tasks.md', check:{file:'node', args:['-e', 'setTimeout(() => process.exit(1), 5000)']}}, {sessionID:'s'});
    h.emit(success('evt_1'));
    await new Promise(resolve => setTimeout(resolve, 200));
    h.emit({id:'stop_1', type:'session.execution.interrupted', data:{sessionID:'s'}});
    await waitFor(() => storage.get('session:s')?.enabled === false, 1500);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(h.prompts.length, 0);
    assert.match(storage.get('session:s').reason, /interrupted/);
  } finally {
    await dispose();
    await rm(directory, {recursive:true});
  }
});

test('resume preserves counters across plugin restart and block has its own phase', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-resume-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  let dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({action:'enable', path:'tasks.md'}, {sessionID:'s'});
    h.emit(success('evt_1'));
    await waitFor(() => h.prompts.length === 1);
    await h.getTool().execute({action:'pause'}, {sessionID:'s'});
    const before = storage.get('session:s');
    await dispose();
    dispose = await plugin.setup(h.ctx);
    const result = JSON.parse((await h.getTool().execute({action:'resume'}, {sessionID:'s'})).content);
    assert.equal(result.phase, 'active');
    for (const field of ['runs','unchanged','digest','idleTools']) assert.equal(result[field], before[field]);
    const blocked = JSON.parse((await h.getTool().execute({action:'block', reason:'Missing external credential'}, {sessionID:'s'})).content);
    assert.equal(blocked.phase, 'blocked_external');
    assert.equal(blocked.enabled, false);
  } finally {
    await dispose();
    await rm(directory, {recursive:true});
  }
});

test('a green check stops the loop even when checkboxes remain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-gate-green-'));
  await writeFile(join(directory, 'tasks.md'), '- [ ] One');
  const storage = new Map();
  const h = broadcastCtx(directory, storage);
  const dispose = await plugin.setup(h.ctx);
  try {
    await h.getTool().execute({
      action: 'enable',
      path: 'tasks.md',
      check: {file: 'node', args: ['-e', 'process.exit(0)'], timeoutMs: 20000, maxOutput: 500},
    }, {sessionID: 's'});
    h.emit(success('evt_1'));
    await waitFor(() => storage.get('session:s')?.lastCheck);
    const state = storage.get('session:s');
    assert.equal(state.enabled, false);
    assert.equal(state.reason, 'Gate check passed');
    assert.equal(state.lastCheck.code, 0);
    const status = JSON.parse((await h.getTool().execute({action:'status'}, {sessionID:'s'})).content);
    assert.equal(status.lastCheck.code, 0);
    assert.equal(typeof status.lastCheck.durationMs, 'number');
    assert.equal(status.lastCheck.truncated, false);
    assert.equal(h.prompts.length, 0, 'a passing check queues nothing');
  } finally {
    await dispose();
    await rm(directory, {recursive: true});
  }
});

