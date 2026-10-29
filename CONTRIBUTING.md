# Contributing

This is an experimental Windows-first project. Discuss larger changes in an
issue before implementation; other adapters belong in separate changes/packages.

## Development

Use Node.js 22+ and run:

```powershell
npm ci
npm test
npm run check
```

Keep changes small and add regression tests for behavior changes. Preserve a
single continuation owner, durable-event deduplication and cancellation priority.
Do not execute commands from task Markdown. Never introduce runtime telemetry,
automatic permission/model changes or credentials in source.

Tests using fake OpenCode contexts must not be described as live E2E. Report
verified, not-run, failed and externally blocked checks separately. Live smoke
must follow [state/SMOKE.md](state/SMOKE.md) in a short, separate session.

Do not commit local configuration, tokens, logs or private session data.
Contributions are licensed under the repository's MIT license.

## По-русски

Используйте Node.js 22+, запускайте команды выше. К исправлениям добавляйте
регрессионные тесты; сохраняйте одного владельца, дедупликацию и приоритет отмены.
Не выдавайте фейковые события за живой E2E. Для smoke следуйте протоколу в
отдельной короткой сессии. Большие изменения сначала обсудите в issue.
