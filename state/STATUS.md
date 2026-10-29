# Статус

Обновлено: 2026-10-29. Ветка: `phase-2-opt-in-check` (локально).

## Что это

Плагин автопродолжения для OpenCode V2. Версия 0.1.0, приватная, не
публиковалась.

## verified

- Плагин загружается в OpenCode v2.2.1 и регистрирует инструмент
  `task_continuity`.
- `npm test` — **27/27 pass** (policy, lifecycle, dedupe, owner/cancel,
  stagnation, opt-in gate). Гейт запускает реальные дочерние процессы Node;
  события OpenCode в интеграционных тестах фейковые, это не живой E2E.
- Фаза 2 в работе: красный check продолжает закрытый checklist, зелёный
  останавливает цикл; pause во время check не затирается его результатом.
  Acceptance фазы пока не отмечен; живой smoke гейта — not-run.
- Дополнительная сверка verification-gate: превышение лимита вывода считается
  неуспешным гейтом даже при exit 0; Windows batch-файлы отклоняются, shell
  не используется. Повторный `npm test`: 27/27 pass.
- Дефект ожидания interrupt исправлен: обработка успеха не блокирует iterator,
  interruption сохраняет остановку и отменяет активный check. Регрессионный
  тест `interrupt is consumed while a check is running...` проходит.
- Acceptance фазы 2 пройден тестами: красный/зелёный гейт, таймаут,
  усечение вывода, pause и interrupt. Пример README проверен командой
  `node --test test/gate.test.mjs` (5/5). Живой smoke гейта — not-run.
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
- **Живой smoke 2 (2026-10-29): PASS.** Два пункта дали ровно два
  автопродолжения, третьего после закрытия checklist не было; финальный
  `status` — `enabled: false`, `reason: Checklist complete`, `runs: 2`,
  `pending: 0`, `pendingPrompt: null`. Отклонение: прогон шёл в сессии
  реализации, а не в отдельной короткой. Evidence: `state/SMOKE.md`.
- **Фаза 1:** `session.tool.called` учитывается как один вызов инструмента;
  два успешных прогона без инструментов и с неизменным digest останавливают
  цикл по стагнации раньше лимита 12 (`runs: 3`). `status` показывает
  `toolEvents` и `idleTools`. Unit- и интеграционные тесты, 18/18 pass.
  Имена событий — `docs/research/opencode-v2-tool-events.md`.
- Один реальный цикл автопродолжения наблюдался 2026-10-28: `runs=1`,
  `lastEvent=session.execution.succeeded` (до исправления дедупликации).
- Дедупликация по `event.id` подавляет повторную доставку того же события;
  unit-тесты плюс живой smoke 2: один prompt на событие при одном владельце.
- Закрытый checklist не ставит в очередь новое продолжение (unit-тесты);
  smoke 2 завершился `Checklist complete` без лишнего prompt.
- Windows: плагин работает без внешних процессов, ключей и `sh`.

## not-run

- Поведение на macOS и Linux.
- Длительный цикл (ближе к лимиту 12 продолжений).
- Поведение при compaction сессии.
- Чистый перезапуск OpenCode с подсчётом `loading plugin` в журнале: hot reload
  дал четыре строки, поэтому критерий «ровно одна строка» пока не проверен.
  Поведенческий эквивалент (одно исполнение — один prompt) проверен smoke 2.
- Живая подписка на `session.tool.called`: счётчик покрыт фейковыми событиями,
  отдельный прогон с реальным инструментом ещё не записан.

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
(`2 !== 1` до registry) и гонку двух `setup`. Живой smoke 2 (2026-10-29) —
**PASS**: 2 автопродолжения, 0 лишних, финальное `Checklist complete`.
Acceptance фазы 0 по критерию «тесты + живой smoke без дублей» выполнен.
Строка `loading plugin` после чистого перезапуска не проверена (`not-run`);
hot reload дал четыре регистрации, но поведение дало один prompt на событие.

## Окружение

- OpenCode v2.2.1, Node v24.11.1, Windows.
- Установленный плагин: `%USERPROFILE%\.config\opencode\plugins\task-continuity\`.
- Источник истины: этот репозиторий. Деплой — `scripts/install.ps1`.
