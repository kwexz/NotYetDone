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
- Keeps a single continuation owner per process: a repeated plugin load
  releases the previous subscription instead of adding a second one.
- Pause, stop and block mark any queued continuation as cancelled and try to
  revoke it when the runtime exposes `session.inbox.cancel`.
- Bounded: 12 continuations, 3 repeats with an unchanged checklist, and
  stagnation after 2 runs with no tool calls while the checklist did not move.
  `status` shows `runs`, `unchanged`, `idleTools` and `toolEvents`.
- Optional deterministic gate: pass `check` when enabling and the loop ends only
  when that command exits 0. A failing check keeps the loop going, even after
  every box is ticked, and its output tail is added to the next prompt. The
  command comes from the enabling tool call, never from the task file.

## Opt-in check example

`action=resume` reactivates saved control without resetting `runs`, `unchanged`,
digest or `idleTools`. `status.phase` distinguishes `active`, `paused`,
`blocked_external`, `complete`, `limit`, `error` and `gate_passed`. A block
requires a concrete reason and stops continuation until explicit resume.

Only when the user explicitly authorizes running the check, enable with:

```json
{"action":"enable","path":"tasks.md","check":{"file":"node","args":["--test","test/gate.test.mjs"],"cwd":".","timeoutMs":120000,"maxOutput":8000}}
```

`status` includes `lastCheck` with exit code, duration, timeout flag and capped
output tail. Windows batch files (`.cmd`/`.bat`) are rejected; use an executable
directly. Exit 0 ends the loop, not a declaration that all acceptance criteria
have been proven. The existing safety counters still stop repeated failures.

## What it does not do

- It does not prove completion. A checked box is not a passing test. Evidence
  and verification stay the agent's job.
- It does not run commands from task files. The optional `check` is a separate
  argument to the tool call and is rejected unless `action=enable`.
- It does not sandbox the check: it runs with your user rights, network and
  filesystem access. Treat `check` as you would any command you type yourself.
- It does not guarantee revocation of an already queued prompt: this depends on
  the runtime exposing `session.inbox.cancel`. If it does not, the prompt stays
  marked as cancelled in `status`, but may still be delivered.
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

See [`state/STATUS.md`](state/STATUS.md). Short version: 14/14 unit tests pass;
the live smoke after the single-owner fix passed with 2 continuations and no
extras. A clean-restart count of `loading plugin` lines has **not** been run.

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
