# Исследования

Первичные источники и проверки. Читать точечно, не подряд.

| Файл | О чём |
|---|---|
| [`agent-continuation-prior-art.md`](agent-continuation-prior-art.md) | Кто уже решал преждевременные остановки: OpenCode, oh-my-openagent, Claude Code, Codex, Ralph loops. Ссылки на официальную документацию и issues |
| [`omo-v2-evaluation.md`](omo-v2-evaluation.md) | Проверка `oh-my-opencode@5.1.48` в изоляции: V2-entrypoint — заглушка, hooks не регистрируются |
| [`untildone-evaluation.md`](untildone-evaluation.md) | Проверка `yuya-takeyama/untildone` на Windows: ENOENT/EINVAL при spawn, нет `sh`, нет пакета в npm, 46/6 своих тестов |
| [`naming.md`](naming.md) | Проверка имён и namespace: NotYetDone свободен, отклонённые варианты и причины |

## Как это использовать

- `COMPARISON.md` — выводы и что забирать.
- Здесь — доказательства: команды, коды возврата, цитаты из README и
  документации, дата проверки.

Не переносить сюда чужие README целиком. Ссылка + вывод + дата.
