import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskPath, inspect, advance } from '../policy.mjs';
test('only project markdown files', () => { assert.throws(() => taskPath(process.cwd(), '../outside.md')); assert.throws(() => taskPath(process.cwd(), 'tasks.exe')); });
test('checkbox progress and no false success', () => { assert.equal(inspect('- [ ] A\n- [x] B').pending, 1); assert.equal(advance({enabled:true},inspect('nothing')).enabled,false); });
test('bounded continuation and user pause', () => { let state={enabled:true}; const report=inspect('- [ ] A'); for(let i=0;i<4;i++) state=advance(state,report); assert.equal(state.enabled,false); assert.equal(advance({enabled:false}, report).enabled,false); });
