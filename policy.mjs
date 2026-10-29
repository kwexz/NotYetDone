import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

export function taskPath(directory, path) {
  if (typeof path !== 'string' || !path.endsWith('.md')) throw new Error('Specify a Markdown task file');
  const full = resolve(directory, path);
  const rel = relative(resolve(directory), full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Task file must be inside the session project');
  return full;
}

export function inspect(text) {
  const tasks = text.split(/\r?\n/).filter(line => /^\s*-\s+\[[ xX]\]\s+/.test(line));
  const pending = tasks.filter(line => /^\s*-\s+\[ \]/.test(line));
  return { total: tasks.length, pending: pending.length, digest: createHash('sha256').update(text).digest('hex') };
}

export function advance(state, report) {
  if (!state.enabled) return { ...state, reason: 'paused' };
  if (!report.total) return { ...state, enabled: false, reason: 'No checkboxes found; check task file' };
  if (!report.pending) return { ...state, enabled: false, reason: 'Checklist complete; acceptance still requires evidence' };
  const toolEvents = state.toolEvents ?? 0;
  const unchanged = state.digest === report.digest ? (state.unchanged ?? 0) + 1 : 0;
  // Stagnation needs both signals: the checklist did not move and the agent
  // called no tool. Two idle runs are enough; one can be a docs-only turn.
  const idleTools = unchanged > 0 && toolEvents === 0 ? (state.idleTools ?? 0) + 1 : 0;
  const runs = (state.runs ?? 0) + 1;
  if (idleTools >= 2) return { ...state, enabled: false, unchanged, idleTools, runs, toolEvents: 0, reason: 'Stagnation: no tool activity and unchanged checklist' };
  if (unchanged >= 3 || runs > 12) return { ...state, enabled: false, unchanged, idleTools, runs, toolEvents: 0, reason: 'Safety limit: inspect progress before resuming' };
  return { ...state, digest: report.digest, unchanged, idleTools, runs, toolEvents: 0, reason: undefined };
}
