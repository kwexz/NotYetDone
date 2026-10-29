import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskPath, inspect, advance, phaseOf } from '../policy.mjs';
test('legacy states derive all public phases without migration', () => {
  for (const [reason, expected] of [['Paused by request','paused'], ['blocked externally','blocked_external'], ['Gate check passed','gate_passed'], ['Checklist complete','complete'], ['Safety limit','limit'], ['Execution failed','error']]) {
    assert.equal(phaseOf({enabled:false, reason}), expected);
  }
  assert.equal(phaseOf({enabled:true}), 'active');
});
test('completion, limit and error transitions expose distinct phases', () => {
  const active = {enabled:true, phase:'active'};
  assert.equal(phaseOf(advance(active, inspect('- [x] Done'))), 'complete');
  assert.equal(phaseOf(advance(active, inspect('no tasks'))), 'error');
  assert.equal(phaseOf(advance({...active, runs:12}, inspect('- [ ] Work'))), 'limit');
  assert.equal(phaseOf({...active, enabled:false, reason:'Gate check passed'}), 'gate_passed');
  assert.equal(phaseOf({...active, enabled:false, phase:'paused'}), 'paused');
  assert.equal(phaseOf({...active, enabled:false, phase:'blocked_external', reason:'Needs credentials'}), 'blocked_external');
});
test('only project markdown files', () => { assert.throws(() => taskPath(process.cwd(), '../outside.md')); assert.throws(() => taskPath(process.cwd(), 'tasks.exe')); });
test('checkbox progress and no false success', () => { assert.equal(inspect('- [ ] A\n- [x] B').pending, 1); assert.equal(advance({enabled:true},inspect('nothing')).enabled,false); });
test('bounded continuation and user pause', () => { let state={enabled:true}; const report=inspect('- [ ] A'); for(let i=0;i<4;i++) state=advance(state,report); assert.equal(state.enabled,false); assert.equal(advance({enabled:false}, report).enabled,false); });
test('stagnation stops before the hard limit', () => {
  let state = {enabled: true};
  const report = inspect('- [ ] A');
  state = advance(state, report);
  state = advance(state, report);
  assert.equal(state.enabled, true, 'one idle run is allowed');
  assert.equal(state.idleTools, 1);
  state = advance(state, report);
  assert.equal(state.enabled, false);
  assert.match(state.reason, /Stagnation/);
  assert.equal(state.runs, 3);
  assert.equal(state.idleTools, 2);
});
test('a complete checklist keeps running when an opt-in check decides', () => {
  let state = { enabled: true };
  const report = inspect('- [x] A');
  state = advance(state, report, { completeTerminal: false });
  assert.equal(state.enabled, true, 'the check, not the checkbox, ends this loop');
  assert.equal(state.runs, 1);
  state = advance(state, report, { completeTerminal: false });
  state = advance(state, report, { completeTerminal: false });
  assert.equal(state.enabled, false, 'the counters still bound a closed checklist');
  assert.match(state.reason, /Stagnation/);
});
test('tool events reset stagnation and the per-run counter', () => {
  let state = {enabled: true};
  const report = inspect('- [ ] A');
  state = advance(state, report);
  state = advance({...state, toolEvents: 1}, report);
  state = advance({...state, toolEvents: 1}, report);
  assert.equal(state.enabled, true);
  assert.equal(state.idleTools, 0);
  assert.equal(state.toolEvents, 0, 'counter resets after a successful run');
  assert.equal(state.unchanged, 2);
});
