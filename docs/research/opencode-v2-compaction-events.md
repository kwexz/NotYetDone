# OpenCode V2 compaction events

Verified against installed @opencode/schema via @opencode/plugin 2.2.0:
`node_modules/@opencode/schema/dist/event-manifest.d.ts` declares
`session.compaction.started`, `.delta`, `.ended`, `.failed`.
The ended event is durable and includes `data.sessionID` and reason
`auto` or `manual` (declaration around lines 3938–3948).

Implementation subscribes only to ended, sets a storage recovery marker and
adds task/counter context to the next normal continuation. Compaction itself
never queues a prompt. Test uses fake OpenCode events, not a live compaction.
Live compaction: not-run. Conditional fallback for absent events does not
apply because the installed schema provides the event.
