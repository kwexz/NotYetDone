# Имя и пространства имён

Проверка на 2026-10-28. Точные запросы: `api.github.com/repos/kwexz/<name>`,
`registry.npmjs.org/<name>`, `registry.npmjs.org/@kwexz%2f<name>`,
`pypi.org/pypi/<name>/json`, поиск GitHub по `in:name`.

**Это не юридическая проверка и не гарантия.** Доступность меняется; перед
регистрацией повторить. Товарные знаки и домены отдельно не проверялись
(отсутствие DNS-записи не означает, что домен свободен).

## Итог: NotYetDone

| Артефакт | Статус |
|---|---|
| `github.com/kwexz/notyetdone` | 404 — свободен |
| npm `notyetdone` | 404 — свободен |
| npm `@kwexz/notyetdone` | 404 — свободен |
| PyPI `notyetdone` | 404 — свободен |
| Поиск GitHub | 2 результата, оба 0★ без описания |
| GitHub user `notyetdone` | существует (не мешает репозиторию под `kwexz`) |

Почему подходит: читается без объяснений, точно описывает роль («ещё не
готово»), масштабируется в `notyetdone-core`, `notyetdone-opencode`,
`notyetdone-claude`.

## Отклонённые варианты

| Имя | Причина отказа |
|---|---|
| **Taskline** | org `taskline` существует (2020, пустая); npm `taskline` занят Redis-очередью 0.1.3 |
| **Continuum** | org `continuum` активна, 54 репозитория; имя перегружено брендами |
| **Taskwarden** | четыре одноимённых task-manager проекта на GitHub, два коммерческих сервиса (`taskwarden.com`, `taskwardenapp.com`). Namespace формально свободен, но смешение гарантировано |
| **Proofline** | npm занят (0.1.0, «verification layer for the AI-coding era»), PyPI занят (0.4.0, «Verifiable run bundles…»), плюс `sfayka/Proofline` — «Acceptance layer for validating agentic completion against user intent and evidence». Тот же смысл под тем же именем |
| **Until-done** | npm занят («waits until condition is met»); `TameTheGame/until-done` — «keep an agent working until a goal is proven done»; `srinitude/pi-until-done` 34★ |
| **untildone** | npm 404, но имя занято репозиторием-супервизором для OpenCode CLI |
| **Finish-him** | namespace свободен, но `dvdknv/finish-him` — agent skill с той же задачей; «Finish him!» — цитата Mortal Kombat |
| **Dontstopper** | полностью свободен (0 результатов), но нечитаем и негативен |
| **NotYet** | npm/PyPI свободны, но 194 результата в поиске, включая `leahneukirchen/notyet` (21★, task tracker) и `OFFENSAI/notyet` (47★) |
| **ididit** | npm занят, GitHub habit tracker 233★ |
| **notsofast**, **receipts**, **lgtm**, **shipit**, **proveit**, **madeit**, **donedone** | заняты или шумные; `receipts` рядом с `claude-receipts` (629★) |

## Что проверить перед публикацией

- повторить GitHub/npm/PyPI запросы;
- домен у регистратора (не только DNS);
- товарный знак в целевых странах, если планируется коммерческое
  использование;
- NuGet, crates.io, Open VSX, Docker Hub — только если появятся
  соответствующие адаптеры.
