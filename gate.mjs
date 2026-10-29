import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

// The check is an opt-in executable named by the user in the tool call. It is
// never read from the task file: a checked box stays evidence, not a command.
const FIELDS = ['file', 'args', 'cwd', 'timeoutMs', 'maxOutput'];
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT = 8_000;
const MAX_OUTPUT = 64_000;
const MAX_ARGS = 100;
const MAX_ARG_LENGTH = 4_000;
const WINDOWS = process.platform === 'win32';

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function withExtensions(dir, name) {
  const list = [join(dir, name)];
  if (WINDOWS && !extname(name)) {
    for (const ext of (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)) {
      list.push(join(dir, name + ext.toLowerCase()), join(dir, name + ext));
    }
  }
  return list;
}

export async function resolveExecutable(root, file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('check.file must be a non-empty string');
  if (/[\0\r\n]/.test(file)) throw new Error('check.file must be a single path');
  if (isAbsolute(file)) throw new Error('check.file must be relative to the project or a command name');
  const hasSeparator = file.includes('/') || file.includes('\\');
  if (hasSeparator) {
    const target = resolve(root, file);
    if (!inside(root, target)) throw new Error('check.file must stay inside the project');
    for (const candidate of withExtensions(dirname(target), basename(target))) if (await isFile(candidate)) return candidate;
  } else {
    for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const candidate of withExtensions(dir, file)) if (await isFile(candidate)) return candidate;
    }
  }
  throw new Error(`check.file not found: ${file}`);
}

export async function parseCheck(root, input) {
  root = await realpath(root);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('check must be an object');
  const unknown = Object.keys(input).filter(key => !FIELDS.includes(key));
  if (unknown.length) throw new Error(`check has unknown fields: ${unknown.join(', ')}`);

  const file = await resolveExecutable(root, input.file);
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw new Error(`check.args must be an array of at most ${MAX_ARGS} strings`);
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH || /[\0\r\n]/.test(arg)) {
      throw new Error('check.args entries must be single-line strings');
    }
  }

  if (input.cwd !== undefined && typeof input.cwd !== 'string') throw new Error('check.cwd must be a string');
  const cwd = input.cwd === undefined ? root : resolve(root, input.cwd);
  if (!inside(root, cwd)) throw new Error('check.cwd must stay inside the project');
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw new Error('check.cwd does not exist');
  }
  if (!info.isDirectory()) throw new Error('check.cwd must be a directory');
  if (!inside(root, await realpath(cwd))) throw new Error('check.cwd symlink escapes project');
  if ((input.file.includes('/') || input.file.includes('\\')) && !inside(root, await realpath(file))) throw new Error('check.file symlink escapes project');
  if (WINDOWS && /\.(cmd|bat)$/i.test(file)) throw new Error('Windows batch files require a shell; use node with a script argument');

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`check.timeoutMs must be an integer between 100 and ${MAX_TIMEOUT_MS}`);
  }
  const maxOutput = input.maxOutput ?? DEFAULT_MAX_OUTPUT;
  if (!Number.isInteger(maxOutput) || maxOutput < 200 || maxOutput > MAX_OUTPUT) {
    throw new Error(`check.maxOutput must be an integer between 200 and ${MAX_OUTPUT}`);
  }
  return { file, args: [...args], cwd, timeoutMs, maxOutput };
}

function commandFor(file, args) {
  if (WINDOWS && /\.(cmd|bat)$/i.test(file)) throw new Error('Windows batch files require a shell; use an executable such as node with a script argument');
  return { file, args };
}

export function runCheck(check, options = {}) {
  const started = Date.now();
  return new Promise(done => {
    if (options.signal?.aborted) {
      done({code:null, signal:null, passed:false, error:'check aborted', timedOut:false, durationMs:0, output:'', truncated:false, totalBytes:0});
      return;
    }
    const maxOutput = check.maxOutput;
    let output = '';
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    let command;
    try {
      command = commandFor(check.file, check.args);
    } catch (error) {
      done({ code: null, signal: null, timedOut: false, durationMs: 0, output: '', truncated: false, totalBytes: 0, error: error.message, passed: false });
      return;
    }

    let child;
    try {
      child = spawn(command.file, command.args, { cwd: check.cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      done({ code: null, signal: null, timedOut: false, durationMs: Date.now() - started, output: '', truncated: false, totalBytes: 0, error: error.message, passed: false });
      return;
    }

    const take = chunk => {
      const text = chunk.toString();
      totalBytes += Buffer.byteLength(text);
      output += text;
      if (output.length > maxOutput) {
        truncated = true;
        output = output.slice(-maxOutput);
      }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      done({ ...result, timedOut, durationMs: Date.now() - started, output, truncated, totalBytes, passed: !timedOut && !truncated && !result.error && result.code === 0 });
    };

    const kill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may already be gone.
      }
    };
    const abort = () => {
      kill();
      finish({ code: null, signal: 'SIGKILL', error: 'check aborted' });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, check.timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });

    child.on('error', error => finish({ code: null, signal: null, error: error.message }));
    child.on('close', (code, signal) => finish({ code, signal, error: timedOut ? `check timed out after ${check.timeoutMs}ms` : undefined }));
  });
}
