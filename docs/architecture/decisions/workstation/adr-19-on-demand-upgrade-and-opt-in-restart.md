# ADR-19: On-demand upgrade and opt-in restart

📌

`open-agent upgrade` upgrades only the guest tools the user names, or all of them. With `--restart`, the host then restarts each service that still runs an older version of a tool it runs on. A service that would cut an agent turn short waits until no turn is in flight, unless `--force` is given. The updater itself still never touches a service.

- Status: `Accepted`
- Date: `2026-11-08`
- Amends: [ADR-12 — In-place maintenance without service restarts](adr-12-in-place-maintenance.md) (the updater's no-restart rule stands)

## 🎯 Motivation

The only way to upgrade on demand was `setup --section tools --update`. It reinstalls the setup plan, upgrades every tool and never restarts anything, so a new T3 Code or Tailscale took effect only after an unrelated restart. Users want to upgrade one tool, such as `codex`, without waiting a day for the schedule. They also want to put a new agent or network version into service without interrupting a turn.

## 🧭 Context

- ADR-12 forbids the updater from issuing any service command, and an end-to-end scan enforces that. It also rejected staging an upgrade until a safe point, because that needed safe-point detection.
- The idle governor (ADR-13) already records harness turn holds. `UserPromptSubmit` opens a hold under the harness's name and `Stop` closes it, so the governor knows whether a turn is in flight.
- Harnesses (Claude Code, Codex) run as processes the agent spawns per turn, not as services. Only the agent (`t3-code`) and the network daemon (`tailscaled`) are long-running services.
- Both service backends report a service's start time.

## ✅ Decision

- **Command.** `upgrade <workstation> [tools]` takes an optional comma list, checked against the tools `environment.json` records. An unknown name is a `USAGE` error. A workstation whose agent service records no `runsOn` was set up by an earlier release, whose update gate takes no selection; the command refuses it with `CONFLICT` and names the `setup` that brings it up to date. The command runs the update gate as `update-gate.sh --force --only <tools>` from its setup session. `setup --update` shares the same update run without a selection.
- **Selective update.** With `--only`, the updater upgrades only the named tools and records the `selection` in `update-status.json`. It never moves `lastSuccess`, which remains the verdict of a run over every tool.
- **Install time.** For each tool an upgrade installs, the updater records `installedAt` beside its `version` in `environment.json`. That file persists across runs, so the time survives partial and later runs.
- **Which services restart.** Each service declares `runsOn`, the tools whose upgrade leaves it on an old version: `t3-code` runs on `t3`, `bun` and `node`, and `tailscaled` runs on `tailscale`. With `--restart`, a running service restarts when it started before the `installedAt` of a tool in its `runsOn`. Running `upgrade --restart` again therefore restarts a service that a cron run or an earlier upgrade left behind. Harnesses are never restarted.
- **Who restarts.** The host restarts services through `GuestServiceControl.restart` (runit's `sv restart`, or the Sprite services API), never the updater. After the agent's service restarts, the host exposes it again once it serves.
- **Waiting for idle.** A service that declares `waitsForIdle` (only `t3-code`) waits until two polls in a row, 15 seconds apart, show no unexpired governor hold from a selected harness. `tailscaled` restarts at once. The wait gives up after 30 minutes, or after `--wait-timeout`. A service that did not restart is reported as `deferred`, and the command exits non-zero. `--force` restarts without waiting. `--force` or `--wait-timeout` without `--restart` is a `USAGE` error.
- **Failed tools.** A tool that fails to upgrade does not stop the run: the updater upgrades the other tools, and the requested restarts still run. The command then reports each failed tool and exits non-zero with `PROVIDER`, and its retry hint repeats the request.
- **Interactive menu.** The workstation menu offers **Upgrade tools**. It asks for the tools, with every recorded tool chosen at first, and then for one of three restart modes: leave services running, restart once no agent turn is in flight (`--restart`), or restart now (`--restart --force`). Choosing no tool returns to the menu without upgrading anything.

## 🔀 Alternatives considered

- **A `--only` flag on `setup --update`.** Setup reinstalls the whole plan first and has no place for restart options.
- **The updater restarts services.** This would break ADR-12's rule and its scan, and the guest would have to own the busy check.
- **Restart what this run installed.** A rerun after a timed-out wait, or after cron had already upgraded the tool, would restart nothing.
- **Kill turns, or ignore activity.** This interrupts the work the no-restart rule protects.

## 🤝 Accepted Trade Offs

- The idle signal covers only turns whose harness hooks fire. Work outside the hooks does not delay a restart (ADR-13's coverage limit).
- A stale hold from a crashed turn delays a restart until it expires or the wait times out.
- `setup` rewrites `environment.json` and drops the recorded install times, so a restart still pending from an earlier `upgrade` is forgotten after a setup.
- A harness process that the agent keeps alive keeps its old version until the agent spawns it again.
- `tailscaled` restarts without waiting for idle. When the workstation routes its outbound traffic through a Tailscale exit node, a turn in flight may lose its connections for the restart.

## ⚖️ Consequences

- The CLI has seven commands.
- ADR-12's rejection of "activate at a safe point" no longer holds for this opt-in path. The host now detects the safe point from the governor, and the scheduled update is unchanged.
- On runit, the first `setup` after this change re-registers `t3-code` and `tailscaled` once, since runit compares the whole stored definition and both definitions gained `runsOn`.
