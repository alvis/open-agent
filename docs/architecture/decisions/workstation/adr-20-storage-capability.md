# ADR-20: Storage as a declared provider capability

📌

Each provider declares what its persistent storage can do as one `storage` capability: its size, its limit, and how it grows. Workstations then grow their storage before it fills on every provider able to do so, and no code outside a provider names a provider to decide it.

- Status: `Accepted`
- Date: `2026-11-07`

## 🎯 Motivation

A user creates a Fly Machine workstation and works on it for a few weeks. The agent installs Homebrew bottles, Google Chrome, a Rust toolchain and project dependencies onto the 10 GB volume that holds every home directory and tool. One afternoon the volume fills: package installs fail, the harness cannot write its session, and the only recovery is to recreate the workstation, which takes 32 to 40 minutes of setup.

A Sprite in the same situation behaves differently: its disk is a fixed, sparse 100 GB billed by blocks written, and cannot grow at all. Growing storage therefore has to be offered where a provider can grow it, refused or reported as unsupported where it cannot, and capped where growth is billed. Without a declared answer, each place that cares (prompts, validation, creation, setup, inspection) would have to know which provider it is talking to.

## 🧭 Context

Providers describe how they differ through capability axes, declared as data on each provider driver: how the guest is reached, who decides when it sleeps, whether a resize restarts it, and so on. Application code branches on those axes, never on a provider's name. The only storage fact among them was `persistence`, naming where data survives sleep; nothing described size or growth.

A Fly Machine's volume can grow in two ways the provider offers: a mount configured with a usage threshold, a growth step and a size limit, which Fly applies itself; and an extend operation in the Machines API, which the host can call with the management token. A probe on 2026-11-07 showed native growth took effect online within 31 seconds, with the filesystem grown and no restart, and that the machine's own guest-local API refuses volume operations, so a guest cannot extend its own volume. Management tokens never leave the user's computer.

## ✅ Decision

Storage is one grouped capability on `ProviderCapabilities`. Every provider declares a `storage` capability: `persistence`, `defaultGb`, `maxGb`, the guest `path` holding the persistent data, the automatic `growth` mechanisms it supports in preference order, and `hostExtend`, whether the host can grow it on request. Fixed storage is an empty `growth` list with `hostExtend: false`.

Two growth mechanisms exist:

- `provider-auto`: the provider grows storage itself. open-agent writes the user's policy (threshold, step, limit) into the provider's configuration when the workstation is created.
- `guest-extend`: the idle governor's per-minute tick runs a storage watcher that grows storage through a provider-supplied, root-only storage adapter, declared as the provider's `storageAsset`. The adapter answers `storage-size` with `size <GB>`, the size provisioned now, and `extend-storage <GB>` with `grown <GB>`, or either with `failure <detail>`. The watcher makes at most one attempt every five minutes, under a lock of its own, and when a provider declares both mechanisms it waits until the size has not changed for five minutes, so the provider's own growth goes first.

Pure domain rules in `src/domain/storage.ts` derive support, the starting size, the effective policy and every storage refusal from the declaration; every other module calls them. Automatic growth is on by default where supported, growing 10 GB at 80% usage up to a 100 GB limit, each overridable. The limit is raised to the starting size and lowered to the provider's maximum; a limit the user supplies outside that range is refused while growth is on, and a policy flag that would have no effect is refused. A request the provider cannot satisfy is refused at profile validation; the default on an unsupported provider is reported, not refused.

The policy is fixed when a workstation is created and recorded in its `environment.json`, which later setups carry forward unchanged. An existing workstation can be grown explicitly with `setup --storage`, through the provider's host extend operation, up to the provider's maximum and never smaller; the growth limit does not apply, the policy does not change, and the size is not recorded as the profile's minimum.

A Fly Machine declares `provider-auto` and `hostExtend`, up to 500 GB; a Sprite declares a fixed 100 GB. No shipped provider declares `guest-extend`, because placing a management credential on the guest is not acceptable.

## 🔀 Alternatives considered

- **Flat storage axes beside the others.** Smallest change, but it scatters persistence, size and growth across unrelated fields and gives derived support no home.
- **A feature registry**, where every optional feature declares its requirements, options, steps and inspection. It would make rollout fully generic, but would retrofit idle, resize, exit node and proxy before this capability ships, for two providers.
- **Only a guest watcher.** It would duplicate Fly's native growth, put limit enforcement in open-agent alone and, on Fly, need a management credential on the guest.
- **Only explicit growth through setup.** Not automatic; a disk still fills mid-session.
- **Opt-in growth, or growth with no open-agent limit.** Rejected for silent full disks and unbounded, irreversible cost respectively.
- **Applying the policy to existing workstations on their next setup.** Rejected by the owner to avoid restarting existing machines.

## 🤝 Accepted Trade Offs

- Grown space is billed until the workstation is terminated, because storage cannot shrink. This buys a workstation that does not stop when its disk fills.
- Workstations created before this decision keep no recorded policy and grow only through `setup --storage`. This buys zero restart risk for them.
- The guest watcher is built and tested without a shipped provider using it. This buys a fallback that any provider with guest-reachable growth gets by declaration alone.

## ⚖️ Consequences

Adding a provider means filling one `storage` block, plus `extendStorage` on the driver when it declares `hostExtend` and a `storageAsset` when it declares `guest-extend`; the registry's spec fails for a registered provider whose declaration lacks either. Prompts, validation, creation, setup and inspection follow. A repository search spec keeps storage interpretation inside the provider drivers, the composition root and the storage rules.

Storage findings appear in `show --inspect` and `doctor`. `doctor` warns when storage is 95% full, when it is past its threshold at its limit, or when the watcher's last attempt failed, and a failed storage measurement is a warning too; none of these fail readiness. A Fly Machine created with a policy keeps it in its machine configuration even if a later release drops the feature, until it is terminated or its mount is changed by hand. If a provider's native growth ever needs a restart to take effect, its declaration must say so before growth is offered as automatic there.
