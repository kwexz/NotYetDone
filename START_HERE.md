# START HERE

NotYetDone — continuation plugin for coding agents, currently OpenCode V2 only.

## Read in this order

1. This file.
2. [`state/STATUS.md`](state/STATUS.md) — what is actually verified, what is not.
3. [`docs/DECISIONS.md`](docs/DECISIONS.md) — decisions that must not be
   silently reversed.
4. One task from [`docs/ROADMAP.md`](docs/ROADMAP.md) — the current phase only.
5. `docs/COMPARISON.md` when you need to know what an analog already solved.

Do not read all of `docs/research/` up front. Open the specific file you need.

## Current state

- Working plugin, 9/9 tests green, installed globally and loaded by OpenCode.
- Duplicate-continuation bug fixed by event-identity deduplication.
- **Not verified:** live auto-continuation after that fix; a two-item smoke
  checklist is the first thing to run.
- Nothing published. No npm package, no GitHub remote yet.

## First actions in a new session

```powershell
cd <LOCAL_PATH>
npm ci
npm test
```

Then run the smoke checklist in [`state/SMOKE.md`](state/SMOKE.md) to confirm
the fixed plugin still continues and still stops.

## Rules that matter

- One continuation owner. Do not install a second continuation mechanism
  (oh-my-openagent, Ralph loops, external supervisors) next to this plugin.
- Stop/interrupt outranks any success event.
- A checkbox is not evidence. Never mark a task complete because a box is
  checked, and never check a box to stop the loop.
- Do not publish, tag or push until the user asks.
- Windows is the verified target. macOS and Linux are untested.

## Repository map

```
index.mjs            plugin entry (OpenCode V2 server plugin)
policy.mjs           pure logic: path validation, checklist inspection, limits
test/                unit + regression tests (node --test)
scripts/install.ps1  deploy to the global OpenCode plugin directory
docs/                decisions, comparison, roadmap, primary-source research
state/               status, smoke checklist, evidence
```
