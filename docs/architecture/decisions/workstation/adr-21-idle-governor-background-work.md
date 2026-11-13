# ADR-21: Shared heartbeat idle governor that keeps background work awake

📌

One idle governor in the guest decides how long a workstation stays awake, from harness heartbeats, turn holds and managed-operation holds. A Claude Code or Codex turn that ends while one of its background commands is still running keeps its hold until a later turn ends with none left. Each provider supplies only a small awake adapter that applies the governor's decision.

- Status: `Accepted`
- Date: `2026-11-13`

## 🎯 Motivation

A user asks the agent on a Sprite workstation to run a project's full unit suite. The suite takes longer than Claude Code's foreground limit, so the agent runs it in the background and ends its turn, expecting Claude Code to start the next turn when the suite finishes. A Codex agent does the same with a background terminal. Nothing fires a hook while the suite runs. Five minutes after the last tool call the workstation's deadline passes, the Sprite goes cold, and the suite freezes or is lost. The session stays stalled until the user sends a message, which wakes the Sprite. On one workstation this happened four times in a single day, and once the suite died with a bus error while the disk reconnected on wake.

Keep-awake logic also used to be a Sprite-specific task hold inside the hooks and the updater. A second provider would have needed its own copy, and idle timeouts could not be configured. Providers differ: a Sprite keeps itself awake until a deadline and then applies its own idle rules, while a Fly machine has to be told to suspend or stop.

## 🧭 Context

- Providers declare `keepAwakeMode` (`native-deadline`, `governed` or `none`), `wakeMode`, `supportsCliWakeSleep` and `maxAwakeDeadlineMinutes` as capability axes (ADR-9).
- Harness hooks run as the agent account; managed operations run as root. Root must never run code the agent account can write.
- Claude Code fires `UserPromptSubmit` when a turn starts, including a turn started by a background command's completion notice, `PreToolUse` before each tool call, `Stop` when a turn ends and `SessionEnd` when a session ends.
- Claude Code points a command's standard output at a file in the session's tasks directory, `<temporary root>/claude-<uid>/<project>/<session id>/tasks/<task id>.output`. The shell it starts is a child of the Claude Code process and lives until the command ends.
- Codex gives every command it runs the session's thread id in `CODEX_THREAD_ID`, the id its hooks report as `session_id`. A background terminal stays running across turns until the session ends or the user cleans it up. Codex runs a hook command through the account's login shell (`$SHELL -lc`).

## ✅ Decision

The governor treats a turn as finished only when it has no background work left. While a Claude Code or Codex background command runs, the turn that started it keeps the workstation awake, up to the hold maximum.

- **Inputs.** Harness hooks run the root-owned awake command:
  - turn start opens a turn hold;
  - each tool call is a heartbeat;
  - turn end and session end close the hold;
  - a turn end refreshes the hold instead of closing it while a process still descended from the harness process that ran the hook carries the session's mark. Such a process is a background command the turn left running. Each harness driver declares its mark, and its turn-end hook passes it to the governor, which knows no harness: the path a command's standard output links to, a pattern with the session id in it (Claude Code: its tasks directory), or an environment variable holding the session id (Codex: `CODEX_THREAD_ID`). A new harness gets the same rule by declaring its mark. A process a command left detached has another parent and does not count, nor do the hook's own shells and the awake command's processes. `SessionEnd`, Codex's `Interrupt` and other harnesses' events always close.

  The session comes from the hook's own input, read within a bounded time. The command always exits 0 within a bounded time, so it never fails a turn, and each hook's timeout leaves room for the command to start on a workstation just woken or under heavy load.

- **Holder state.** Holder state is data only:
  - Agent holders live in `run/awake`. Managed holders live in `run/awake-root`, which the agent can read but not change.
  - Root reads every holder as untrusted data.
  - Root never takes a lock the agent can write.
  - A scan that cannot see every holder fails closed.
- **Deadline.** The deadline is the later of (last heartbeat + idle timeout, default 5 minutes) and the latest open hold. A hold expires at the hold maximum (default 60 minutes) after its last refresh.
  - Managed holds refresh while their operation runs, and are pruned once their process is gone.
  - A hold a background command kept ends when a later turn of the session ends with no background work left, or at the hold maximum.
  - With an idle timeout of 0, only holds keep the workstation awake.
- **Sleep decision.** The governor may initiate sleep only when the provider is `governed`, the idle timeout is above 0, and a wake path exists: `url-traffic`, or `cli-restore` with `supportsCliWakeSleep`. Otherwise it records state only.
- **Adapters.** Each adapter is a `<name>-awake` module in the provider's own guest folder. It is checked on the host, in the guest catalog and by the loader.
  - A `native-deadline` adapter (Sprite: one Sprite task whose expiry equals the deadline) runs only as the agent account. A root caller hands the apply to a child process running as the agent account.
  - A `governed` adapter runs as root from a periodic tick (at least every 3 minutes), with no overlapping idle-form call. It is held to the root import-graph rule.
  - Adapters use only guest-local mechanisms and no credentials.
- **Reporting.** The governor records its state in `governor.json`, which `show --inspect` and `doctor` report. A turn end that kept its hold is logged with the reason `background-work`.

## 🔀 Alternatives considered

- **Per-provider keep-awake logic:** duplicates the deadline, hold and validation rules in every provider.
- **A governor daemon for every provider:** needless on providers that already sleep by their own rules after a deadline. Native-deadline dispatch runs per event instead.
- **Treating an open ACP connection as activity:** keeps idle sessions awake indefinitely.
- **Never closing a turn hold at `Stop`:** keeps every idle session awake for the full hold maximum after each turn, and still lets work longer than the maximum stall.
- **Only a longer idle timeout:** wastes awake time on idle sessions, and work longer than the timeout still stalls.
- **Counting any process that carries the session's mark:** a server or watcher a command left detached would keep the workstation awake after every turn of that session.
- **Asking Codex for its background terminals:** the list lives in the Codex process that runs the thread, which a hook command cannot reach.
- **Knowing each harness's mark in the governor:** every new harness would need a governor change, and the governor would have to tell harnesses apart by a source name the hook passes anyway.

## 🤝 Accepted Trade Offs

- Activity outside the hooks and outside Claude Code and Codex background commands (arbitrary shells, detached processes, other harnesses' background tools) does not keep a workstation awake.
- A long-running background server started by the agent keeps the workstation awake until the hold maximum after each turn of its session.
- Background work longer than the hold maximum with no turn in between can still stall.
- A turn whose end hook never fires, such as a Claude user interrupt or a crashed harness, keeps its hold until the hold maximum.
- The background check depends on where Claude Code writes a command's output and on Codex's `CODEX_THREAD_ID`; if either harness changes that mark, its turns close as before.
- A hold a background command kept outlives the command: after it ends, the workstation stays awake until a later turn of the session ends or the hold maximum.
- Sprite tasks expire at most an hour ahead, so a Sprite profile cannot set an idle timeout or hold maximum above 60 minutes.

## ⚖️ Consequences

- A new provider adds one adapter module and its capability axes.
- The governor, its holder rules and its reporting stay shared across all providers.
- A session waiting on its own background command is resumed by that command's result rather than by the user, and a Codex background terminal finishes its work before the workstation sleeps.
