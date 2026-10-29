import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseCheck, resolveExecutable, runCheck } from '../gate.mjs';

const node = 'node';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'continuity-gate-'));
  return { root, done: () => rm(root, { recursive: true, force: true }) };
}

test('check input is validated before anything runs', async () => {
  const { root, done } = await project();
  try {
    await assert.rejects(parseCheck(root, null), /check must be an object/);
    await assert.rejects(parseCheck(root, { file: '' }), /non-empty string/);
    await assert.rejects(parseCheck(root, { file: process.execPath }), /relative to the project/);
    await assert.rejects(parseCheck(root, { file: '../outside.js' }), /stay inside the project/);
    await assert.rejects(parseCheck(root, { file: 'missing-binary-xyz' }), /not found/);
    await assert.rejects(parseCheck(root, { file: node, args: ['-e', 'x'], cwd: '../..' }), /cwd must stay inside/);
    await assert.rejects(parseCheck(root, { file: node, args: ['-e', 'x'], timeoutMs: 5 }), /timeoutMs/);
    await assert.rejects(parseCheck(root, { file: node, args: ['-e', 'x'], timeoutMs: 10_000_000 }), /timeoutMs/);
    await assert.rejects(parseCheck(root, { file: node, args: ['-e', 'x'], maxOutput: 10 }), /maxOutput/);
    await assert.rejects(parseCheck(root, { file: node, args: [1] }), /single-line strings/);
    await assert.rejects(parseCheck(root, { file: node, args: ['a\nb'] }), /single-line strings/);
    await assert.rejects(parseCheck(root, { file: node, command: 'rm -rf /' }), /unknown fields/);
  } finally {
    await done();
  }
});

test('a command name resolves through PATH and defaults are filled in', async () => {
  const { root, done } = await project();
  try {
    const executable = await resolveExecutable(root, node);
    assert.ok(executable.toLowerCase().includes('node'), executable);
    const check = await parseCheck(root, { file: node, args: ['-e', 'process.exit(0)'] });
    // Windows may hand back an 8.3 short path (RUNNER~1) where the caller
    // created the directory under the full name, and vice versa.
    assert.equal(relative(root, check.cwd), '');
    assert.equal(check.timeoutMs, 120_000);
    assert.equal(check.maxOutput, 8_000);
    assert.deepEqual(check.args, ['-e', 'process.exit(0)']);
  } finally {
    await done();
  }
});

test('exit code 0 passes and a non-zero code returns the output tail', async () => {
  const { root, done } = await project();
  try {
    const green = await runCheck(await parseCheck(root, { file: node, args: ['-e', 'process.stdout.write("ok");process.exit(0)'] }));
    assert.equal(green.code, 0);
    assert.equal(green.passed, true);
    assert.equal(green.timedOut, false);
    assert.match(green.output, /ok/);
    assert.ok(green.durationMs >= 0);

    const red = await runCheck(await parseCheck(root, { file: node, args: ['-e', 'console.error("boom");process.exit(3)'] }));
    assert.equal(red.code, 3);
    assert.equal(red.passed, false);
    assert.match(red.output, /boom/);
  } finally {
    await done();
  }
});

test('a slow check is killed and reported as timed out', async () => {
  const { root, done } = await project();
  try {
    const started = Date.now();
    const result = await runCheck(await parseCheck(root, { file: node, args: ['-e', 'setTimeout(() => {}, 5000)'], timeoutMs: 100 }));
    assert.equal(result.timedOut, true);
    assert.equal(result.passed, false);
    assert.match(result.error, /timed out/);
    assert.ok(Date.now() - started < 4000, 'the child must not run to completion');
  } finally {
    await done();
  }
});

test('output is capped and keeps the tail', async () => {
  const { root, done } = await project();
  try {
    const result = await runCheck(await parseCheck(root, {
      file: node,
      args: ['-e', 'process.stdout.write("a".repeat(2000) + "TAIL")'],
      maxOutput: 200,
    }));
    assert.equal(result.code, 0);
    assert.equal(result.truncated, true);
    assert.equal(result.passed, false, 'truncated output is not a passing gate');
    assert.equal(result.output.length, 200);
    assert.ok(result.output.endsWith('TAIL'), 'the tail is what the continuation needs');
    assert.ok(result.totalBytes > 2000);
  } finally {
    await done();
  }
});
