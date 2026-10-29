# Tool events в OpenCode V2

Проверено 2026-10-29 по установленным типам `@opencode/plugin` 2.2.0 и
`@opencode/client` 2.2.0 в
`%USERPROFILE%\.config\opencode\plugins\task-continuity\node_modules\`.

## Какие события есть

`EventSubscribeInput.types` перечисляет:

- `session.tool.called`
- `session.tool.success`
- `session.tool.failed`
- `session.tool.input.started`
- `session.tool.input.delta`
- `session.tool.input.ended`
- `session.tool.progress`

Источник: `@opencode/client/dist/effect/client.d.ts:261` (список типов),
`:1334` (`called`), `:1466` (`success`), `:1368` (`failed`), `:2344`
(`progress`).

## Полезная нагрузка

`session.tool.called`:

```text
data: {
  sessionID, assistantMessageID,
  id,                // идентификатор вызова инструмента
  input: {[x: string]: unknown},
  executed: boolean,
  native?: {...}
}
```

`session.tool.success` содержит тот же `data.sessionID`, `data.id`,
`executed` и `content`/`metadata` результата. `session.tool.failed` содержит
`data.error` и `content`.

## Что считать

Считать **только `session.tool.called`**, по одному событию на вызов
инструмента. Причины:

- `input.*`, `progress` — потоковые события, их число зависит от размера
  ввода и длительности, а не от количества вызовов;
- `success` и `failed` — второе событие того же вызова; учёт обоих даёт
  двойной счётчик;
- `called` приходит до выполнения и есть у каждого вызова, включая
  отклонённые (`executed: false`). Для стагнации важен сам факт попытки
  инструмента, а не её результат.

Счётчик живёт в состоянии сессии (`toolEvents`), увеличивается на
`session.tool.called` и сбрасывается в ноль после успешного исполнения.

## Граница

Проверка типовая: имена и поля взяты из установленного SDK. Живая подписка на
`session.tool.called` в этой фазе не проверялась отдельным прогоном; она
покрыта интеграционным тестом с фейковыми событиями и будет видна в `status`
как `toolEvents`. Если рантайм не присылает событие, счётчик останется нулём —
это проявится как ложная стагнация, поэтому порог `idleTools >= 2`, а не 1.
