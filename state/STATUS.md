# Статус

Обновлено: 2026-10-29. Ветка: `main` (локальный репозиторий, удалённого нет).

## Что это

Плагин автопродолжения для OpenCode V2. Версия 0.1.0, приватная, не
публиковалась.

## verified

- Плагин загружается в OpenCode v2.2.1 и регистрирует инструмент
  `task_continuity`.
- `npm test` — **14/14 pass** (policy, lifecycle, dedupe, owner/cancel).
- `npm run check` — ok.
- Один процесс-владелец продолжения: повторный `plugin.setup` освобождает
  предыдущую подписку (`test/owner.test.mjs`). После hot reload 2026-10-29
  09:48:25Z в журнале было четыре `loading plugin`, но `status` показал
  `instance.active: true` для pid 16964; число активных подписок проверяется
  живым smoke, а не этой строкой.
- Claim до `session.prompt`: одно событие даёт один prompt, повторная доставка
  с тем же `event.id` блокируется записью в storage (unit-тест).
- `pause`/`stop`/`block` помечают `pendingPrompt.cancelled`; отзыв вызывается
  только при наличии `ctx.session.inbox.cancel` (unit-тесты на оба случая).
  В рантайме V2 2.2.1 метод недоступен — см. «Проверка 1.5».
- Один реальный цикл автопродолжения наблюдался 2026-10-28: `runs=1`,
  `lastEvent=session.execution.succeeded` (до исправления дедупликации).
- Дедупликация по `event.id` подавляет повторную доставку того же события —
  только в unit-тестах. Живой прогон показал случай, который она не покрывает
  (см. `failed`).
- Закрытый checklist не ставит в очередь новое продолжение (unit-тесты).
  В живом прогоне 2026-10-29 дубль, поставленный в очередь **до** закрытия,
  всё равно пришёл после закрытия.
- Windows: плагин работает без внешних процессов, ключей и `sh`.

## not-run

- Поведение на macOS и Linux.
- Длительный цикл (ближе к лимиту 12 продолжений).
- Поведение при compaction сессии.
- Повторный живой smoke после исправления владельца (`state/SMOKE.md`, прогон 2).
- Чистый перезапуск OpenCode с подсчётом `loading plugin` в журнале: hot reload
  дал четыре строки, поэтому критерий «ровно одна строка» пока не проверен.

## blocked_external

- Сравнение с `untildone` на POSIX-хосте с ключом Deep Infra. На Windows он
  не запускается (spawn ENOENT/EINVAL, нет `sh`, нет пакета в npm).
- Отзыв уже поставленного сообщения из `session_inbox`: `ctx.session.inbox`
  отсутствует в контексте плагина V2 2.2.1 (`revoke.available: false`), хотя
  клиентский API метод содержит. Пометка `cancelled` работает, отзыв — нет.
  Evidence: «Проверка 1.5» ниже.

## failed

- Собственный набор тестов `untildone`: 46 pass / 6 fail на Windows
  (`spawn EFTYPE`). Это дефект их платформенной поддержки, не нашего кода.
- **Живой smoke 2026-10-29 (OpenCode v2.2.1):** 4 автопродолжения вместо 2;
  два последних пришли после закрытия checklist, четвёртое — уже после
  `action=pause`. Одно событие `session.execution.succeeded`
  (`evt_REDACTED`) дало четыре одинаковых prompt; в
  `session_inbox` они ставились парами с разницей 2 мс. Состояние осталось
  `runs=1`; переход в `Checklist complete` не наблюдался. В журнале текущего
  процесса — четыре `loading plugin` без парных `dispose`. Evidence:
  `state/SMOKE.md`.

## Проверка 1.5 — отзыв очереди (2026-10-29)

Задача: выяснить, можно ли отозвать сообщение из `session_inbox` в V2, без
догадок. Проверялись установленные типы `@opencode/plugin` 2.2.0 и
`@opencode/client` 2.2.0 в
`%USERPROFILE%\.config\opencode\plugins\task-continuity\node_modules\`.

**verified (по типам и рантайму):**

- В клиентском API есть `session.inbox` с методами `list`, `cancel`, `update`
  (`@opencode/client/dist/effect/client.d.ts:59-62`), и
  `SessionInboxCancelInput = {sessionID, inboxID: SessionMessage.ID}`
  (`.../api/api.d.ts:426-431`).
- События `session.inbox.cancelled`, `session.inbox.delivered`,
  `session.inbox.enqueued`, `session.inbox.delivery.changed` есть в
  `EventSubscribeInput`.
- `session.prompt` возвращает `SessionInbox.User` с top-level `id`
  (`@opencode/schema/dist/session-inbox.d.ts:513+`), то есть идентификатор
  поставленного сообщения доступен плагину.
- **Рантайм-проверка 2026-10-29:** `task_continuity action=status` в живом
  сервере (pid 16964, после hot reload установленной копии) вернул
  `revoke.available: false`. Значит, на объекте `ctx.session` метода
  `inbox.cancel` нет, хотя клиентский API его содержит.
- Контекст плагина (`Context.session`) типизирован как
  `Pick<SessionApi, "list" | ... | "instructions">` и не содержит `inbox`
  (`@opencode/plugin/dist/promise/session.d.ts`, `.../effect/session.d.ts`),
  `ctx.rpc` даёт только `call`. Типы и рантайм совпадают: отзыва из плагина
  нет.

**Вывод:** upstream-возможность отзыва существует, но поверхность плагина её не
предоставляет — это `blocked_external` для отзыва уже поставленного сообщения,
с доказательством выше. Реализовано: обязательная пометка
`pendingPrompt.cancelled` при `pause`/`stop`/`block`, фиксация причины
(`session.inbox.cancel unavailable` или `inbox id unknown`), feature-detection
на случай, если рантайм начнёт отдавать метод, и `revoke.available` в `status`.
Остаточное ограничение: уже поставленный prompt может доставиться после
паузы; новые prompt не ставятся.

## Инцидент и исправление

**Симптом:** после уже закрытого smoke-checklist пришёл второй автоматический
prompt.

**Причина:** не доказана. Журнала событий не хватало.

**Исправление (2026-10-29):**

1. Process-global registry владельца: повторный `setup` вызывает `dispose`
   предыдущего, поэтому в одном процессе остаётся одна подписка (D13).
2. Claim в storage (`pendingPrompt`) записывается **до** `session.prompt`;
   повторная доставка того же `event.id` видит claim и не ставит второй prompt.
3. `execution.started` очищает claim, подтверждая потребление prompt.
4. `pause`/`stop`/`block` помечают `pendingPrompt.cancelled` и пытаются
   отозвать сообщение, если рантайм отдаёт `session.inbox.cancel` (D14).
   В V2 2.2.1 метод недоступен — это зафиксировано как `blocked_external`.

**Проверка:** `npm test` — 14/14 pass, включая воспроизведение дефекта
(`2 !== 1` до registry) и гонку двух `setup`. Живой smoke после исправления
ещё не проводился (`not-run`); строка `loading plugin` после чистого
перезапуска не проверена. До этого acceptance фазы 0 не считается пройденным.

## Окружение

- OpenCode v2.2.1, Node v24.11.1, Windows.
- Установленный плагин: `%USERPROFILE%\.config\opencode\plugins\task-continuity\`.
- Источник истины: этот репозиторий. Деплой — `scripts/install.ps1`.
