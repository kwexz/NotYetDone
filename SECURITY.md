# Security policy

NotYetDone is experimental and has no production support or security SLA.
Only the current development branch is maintained.

## Reporting

Please do not include credentials, private task files, raw session databases or
unredacted logs in public issues. If GitHub private vulnerability reporting is
enabled, use the repository's **Security → Report a vulnerability** form.
Otherwise open a minimal issue asking for a private contact channel without
publishing exploit details or sensitive data.

## Trust boundaries

- The opt-in check executes with your user privileges; it is not a sandbox.
- Task Markdown and command output are untrusted data, not command sources.
- Already queued prompt revocation depends on the OpenCode runtime API.
- Do not run an untrusted repository's check commands without reviewing them.

## По-русски

Не публикуйте ключи, приватные задачи, базы сессий и неочищенные логи.
Используйте private vulnerability reporting, если он включён, либо запросите
приватный канал связи без раскрытия деталей. `check` выполняется с правами
пользователя и не является sandbox. Проект экспериментальный, SLA нет.
