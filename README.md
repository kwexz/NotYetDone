# NotYetDone

**Evidence-aware continuation for coding agents.** Currently one adapter: an
in-session plugin for **OpenCode V2**.

The agent says "done". NotYetDone checks the task file and decides whether the
work is actually finished — and if not, sends the agent back to it. Stop and
interrupt always win.

> Working name. Nothing is published: no npm package, no release.

## What it does

- Reads a Markdown checklist (`- [ ]` / `- [x]`) that you name explicitly.
- After a **successful** execution, if unchecked items remain, queues one
  continuation prompt in the same session.
- Stops when the checklist is complete, when you say stop, or when the
  execution is interrupted/failed.
- Never runs twice for the same durable event: event identity is stored in
  memory and in plugin storage, so a replay after reconnect or reload is
  ignored.
- Bounded: 12 continuations, 3 repeats with an unchanged checklist.

## What it does not do

- It does not prove completion. A checked box is not a passing test. Evidence
  and verification stay the agent's job.
- It does not run commands from task files.
- It does not start new work when the checklist is already complete.
- It does not survive a disabled plugin: events are live-only.

## Install (OpenCode V2)

```powershell
git clone <this repo> <LOCAL_PATH>
cd <LOCAL_PATH>
npm ci
pwsh -NoProfile -File scripts/install.ps1
```

The script copies `index.mjs` and `policy.mjs` into
`%USERPROFILE%\.config\opencode\plugins\task-continuity\` and keeps the existing
`node_modules` there. Restart OpenCode afterwards.

## Use

In a session:

```
Enable task_continuity for openspec/changes/<change>/tasks.md and keep going
until it is finished.
```

The agent calls the `task_continuity` tool (`enable`, `pause`, `status`,
`block`). Continuation is **off by default** in every new session. Say `stop`,
`пауза`, `стоп` to disable it immediately.

## Status

See [`state/STATUS.md`](state/STATUS.md). Short version: 9/9 unit tests pass;
a real auto-continuation cycle was observed once; a live re-test after the
duplicate-prompt fix has **not** been run.

## Documentation

- [`START_HERE.md`](START_HERE.md) — where to start.
- [`docs/COMPARISON.md`](docs/COMPARISON.md) — every known analog and what it
  does better.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — why it is built this way.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what to borrow next.
- [`docs/research/`](docs/research/) — primary-source research, including the
  naming and namespace checks.

## License

MIT. See [`LICENSE`](LICENSE).
