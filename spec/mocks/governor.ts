import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtempDisposable,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

/** the guest program directory the governor and its watcher are read from */
const GUEST_ROOT = resolve(import.meta.dirname, '../../guest');

/** records which of the governor's lock descriptors a stand-in was started with */
const LOCK_FDS = `fds=
for fd in 6 7; do test ! -e "/dev/fd/$fd" || fds="$fds$fd"; done
printf 'fds %s\\n' "\${fds:--}" >>"$state/descriptors"`;

/** a df that answers from the measure in its state directory, or fails without one */
const FAKE_DF = `#!/bin/sh
state=$(dirname "$0")
printf 'df %s\\n' "$*" >>"$state/calls"
${LOCK_FDS}
test -e "$state/measure" || exit 1
echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'
cat "$state/measure"
`;

/** a timeout that logs its limits and runs the command without one */
const FAKE_TIMEOUT = `#!/bin/sh
state=$(dirname "$0")
printf 'timeout %s\\n' "$*" >>"$state/calls"
test "$1" != -k || shift 2
shift
exec "$@"
`;

/** a flock that takes a lock unless its state directory marks the descriptor held */
const FAKE_FLOCK = `#!/bin/sh
state=$(dirname "$0")
for fd; do :; done
printf 'flock %s\\n' "$*" >>"$state/calls"
test ! -e "$state/held-$fd"
`;

/** the storage adapter's answers and where it is installed */
export interface StorageAdapterScenario {
  /** the line it prints for `storage-size`, `size 20` when absent */
  size?: string;
  /** its exit status for `storage-size`, 0 when absent */
  sizeExitCode?: number;
  /** the line it prints for `extend-storage`, `grown 30` when absent */
  answer?: string;
  /** its exit status for `extend-storage`, 0 when absent */
  exitCode?: number;
  /** its mode, root's alone when absent */
  mode?: number;
  /** its path below the guest root, `drivers/providers/fixture/storage.sh` when absent */
  path?: string;
  /** true when it is a link to the adapter rather than the adapter itself */
  isLink?: boolean;
  /** true when it lies below a directory beside the guest root, its name the guest root's and more */
  isBesideRoot?: boolean;
}

/** the filesystem df reports, in KB, and where it is mounted */
export interface StorageMeasure {
  /** its name, `/dev/vdb` when absent */
  filesystem?: string;
  sizeKb: number;
  usedKb: number;
  availableKb: number;
  /** its mount point, the recorded storage path when absent */
  mountPoint?: string;
}

/** the governor locks a watcher run cannot take */
export interface StorageLocks {
  /** an idle-form call holds the governor lock */
  isGovernorHeld?: boolean;
  /** the governor lock is missing */
  isGovernorMissing?: boolean;
  /** an earlier watcher holds the storage lock */
  isStorageHeld?: boolean;
}

/** the recorded environment, filesystem, adapter and state one watcher run sees */
export interface StorageScenario {
  /** the recorded growth policy; absent leaves environment.json without one */
  policy?: unknown;
  /** the recorded storage path, `/data` when absent */
  storagePath?: string;
  /** the filesystem df reports; absent makes df fail */
  measure?: StorageMeasure;
  /** the storage adapter */
  adapter?: StorageAdapterScenario;
  /** the id the watcher runs as, the test's own when absent */
  uid?: number;
  /** the locks it cannot take */
  locks?: StorageLocks;
  /** storage.json as an earlier tick left it */
  state?: string;
  /** the tick's time, in epoch milliseconds */
  now: number;
}

/** what one watcher run did */
export interface StorageRun {
  /** the shell's exit status */
  exitCode: number;
  /** every df, timeout, flock and adapter run, in order */
  calls: string[];
  /** each adapter run's arguments */
  attempts: string[];
  /** the lock descriptors each df and adapter run was started with, - for none */
  descriptors: string[];
  /** storage.json once the run ended; undefined when none was written */
  state?: unknown;
  /** storage.json's raw text, empty when none was written */
  stateText: string;
  /** storage.json's permission bits, undefined when none was written */
  stateMode?: number;
  /** each awake event record the run left, as the relay writes it to the machine's log */
  log: string[];
  /** the notes the run left for the governor's diagnostics */
  notes: string[];
}

/** what a governor tick sees: its provider's keep-awake mode and whether the watcher is installed */
export interface TickScenario {
  /** the recorded provider's keep-awake mode */
  keepAwakeMode: 'native-deadline' | 'governed' | 'none';
  /** false when no storage watcher is installed */
  hasWatcher: boolean;
}

const execFileAsync = promisify(execFile);

/**
 * reads storage.json as JSON, or as nothing when it is not
 * @param text the file's contents
 * @returns the parsed state, or undefined when it is not JSON
 */
function parseState(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * extracts the governor's jq definitions and named functions from awake.sh,
 * which runs its command when sourced, so a test runs them as the tick does
 * @param names the functions to extract
 * @returns their source, after the jq definitions
 */
async function governorSource(names: readonly string[]): Promise<string> {
  const awake = await readFile(join(GUEST_ROOT, 'governor/awake.sh'), 'utf8');
  const extract = (pattern: RegExp, name: string): string => {
    const match = pattern.exec(awake);
    if (!match) {
      throw new Error(`awake.sh has no ${name}`);
    }

    return match[0];
  };

  return [
    extract(/^OA_IDLE_JQ_DEFS=\$\(\n[\s\S]*?\n\)\n/m, 'OA_IDLE_JQ_DEFS'),
    ...names.map((name) =>
      extract(
        new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, 'm'),
        name,
      ),
    ),
  ].join('\n');
}

/**
 * runs a governor script in sh with the stand-in df, timeout and flock first
 * on the path and a temporary guest root, whose run, work and event
 * directories the script gets as the governor names them
 * @param setup writes the scenario's files under the guest root and the stand-ins' directory
 * @param program renders the script, given the guest root
 * @param collect reads what the run left, given the guest root, the stand-ins' directory and the shell's status and output
 * @returns what collect read, before the directories are removed
 */
async function runGovernor<T>(
  setup: (root: string, state: string) => Promise<void>,
  program: (root: string) => Promise<string>,
  collect: (
    root: string,
    state: string,
    run: { exitCode: number; stdout: string },
  ) => Promise<T>,
): Promise<T> {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), 'open-agent-governor-'),
  );
  const root = join(directory.path, 'root');
  const state = join(directory.path, 'bin');
  await Promise.all(
    [join(root, 'run'), join(root, 'work'), join(root, 'events'), state].map(
      async (path) => mkdir(path, { recursive: true }),
    ),
  );
  await Promise.all([
    writeFile(join(state, 'df'), FAKE_DF, { mode: 0o755 }),
    writeFile(join(state, 'timeout'), FAKE_TIMEOUT, { mode: 0o755 }),
    writeFile(join(state, 'flock'), FAKE_FLOCK, { mode: 0o755 }),
    writeFile(join(state, 'calls'), ''),
  ]);
  await setup(root, state);
  const run = await execFileAsync('sh', ['-c', await program(root)], {
    env: {
      PATH: `${state}:${process.env.PATH ?? ''}`,
      OA_GUEST_ROOT: root,
      OA_ENVIRONMENT_PATH: join(root, 'environment.json'),
      OA_IDLE_RUN: join(root, 'run'),
      OA_IDLE_WORK: join(root, 'work'),
      OA_IDLE_EVENTS: join(root, 'events'),
      OA_IDLE_RELAY_SCAN: '200',
    },
  }).then(
    ({ stdout }) => ({ exitCode: 0, stdout }),
    (error: { code: number; stdout: string }) => ({
      exitCode: error.code,
      stdout: error.stdout,
    }),
  );

  return await collect(root, state, run);
}

/**
 * writes the stand-in adapter, which records its runs and answers from the
 * stand-ins' directory
 * @param adapter its answers, mode and place
 * @param root the guest root
 * @param state the stand-ins' directory
 * @returns the path environment.json records for it
 */
async function setUpAdapter(
  adapter: StorageAdapterScenario,
  root: string,
  state: string,
): Promise<string> {
  const base = adapter.isBesideRoot ? `${root}-beside` : root;
  const target = `${base}/${adapter.path ?? 'drivers/providers/fixture/storage.sh'}`;
  const real = adapter.isLink ? `${target}.real` : target;
  await mkdir(dirname(real), { recursive: true });
  await writeFile(
    real,
    `state='${state}'
printf 'adapter %s\\n' "$*" >>"$state/calls"
${LOCK_FDS}
if test "$1" = storage-size; then
  cat "$state/size"
  exit ${String(adapter.sizeExitCode ?? 0)}
fi
cat "$state/answer"
exit ${String(adapter.exitCode ?? 0)}
`,
  );
  await chmod(real, adapter.mode ?? 0o700);
  if (adapter.isLink) {
    await execFileAsync('ln', ['-s', real, target]);
  }

  return target;
}

/**
 * writes the stand-in adapter, environment.json, df's measure, the locks and
 * the earlier state a watcher run sees
 * @param scenario the recorded policy, filesystem, adapter, locks and earlier state
 * @param root the guest root
 * @param state the stand-ins' directory
 */
async function setUpWatcher(
  scenario: StorageScenario,
  root: string,
  state: string,
): Promise<void> {
  const { adapter = {}, locks = {}, measure } = scenario;
  const storagePath = scenario.storagePath ?? '/data';
  const target = await setUpAdapter(adapter, root, state);
  await Promise.all([
    writeFile(join(state, 'size'), `${adapter.size ?? 'size 20'}\n`),
    writeFile(join(state, 'answer'), `${adapter.answer ?? 'grown 30'}\n`),
    writeFile(join(state, 'descriptors'), ''),
    writeFile(join(root, 'work/notes'), ''),
    writeFile(
      join(root, 'environment.json'),
      JSON.stringify({
        ...(scenario.policy === undefined ? {} : { storage: scenario.policy }),
        provider: { storagePath, storageAdapter: target },
      }),
    ),
    ...(measure
      ? [
          writeFile(
            join(state, 'measure'),
            `${measure.filesystem ?? '/dev/vdb'} ${String(measure.sizeKb)} ${String(measure.usedKb)} ${String(measure.availableKb)} 0% ${measure.mountPoint ?? storagePath}\n`,
          ),
        ]
      : []),
    ...(scenario.uid === undefined
      ? []
      : [
          writeFile(
            join(state, 'id'),
            `#!/bin/sh\necho ${String(scenario.uid)}\n`,
            {
              mode: 0o755,
            },
          ),
        ]),
    ...(locks.isGovernorMissing
      ? []
      : [writeFile(join(root, 'run/governor.lock'), '')]),
    ...(locks.isGovernorHeld ? [writeFile(join(state, 'held-7'), '')] : []),
    ...(locks.isStorageHeld ? [writeFile(join(state, 'held-6'), '')] : []),
    ...(scenario.state === undefined
      ? []
      : [writeFile(join(root, 'run/storage.json'), scenario.state)]),
  ]);
}

/**
 * reads the lines a file holds
 * @param path the file
 * @returns its non-empty lines, none when it is missing
 */
async function lines(path: string): Promise<string[]> {
  return (await readFile(path, 'utf8').catch(() => ''))
    .split('\n')
    .filter((line) => line !== '');
}

/**
 * runs the storage watcher once, as the tick does, under the governor's
 * locks, with df, flock, the adapter and environment.json standing in for
 * the guest's, then relays every awake event record it left as root's
 * @param scenario the recorded policy, filesystem, adapter, locks, earlier state and time
 * @returns the runs it made, the state it left and the lines it logged
 */
export async function runStorageWatcher(
  scenario: StorageScenario,
): Promise<StorageRun> {
  return runGovernor(
    async (root, state) => setUpWatcher(scenario, root, state),
    async () => `set -u
OA_IDLE_LOCK=$OA_IDLE_RUN/governor.lock
OA_IDLE_LOCK_WAIT=3
OA_IDLE_STORAGE='${join(GUEST_ROOT, 'governor/storage.sh')}'
OA_IDLE_STORAGE_LOCK=$OA_IDLE_RUN/storage.lock
${await governorSource(['oa_idle_place', 'oa_idle_log_event', 'oa_idle_relay_line', 'oa_idle_storage'])}
oa_idle_now() { echo ${String(scenario.now)}; }
oa_idle_storage
for oa_test_record in "$OA_IDLE_EVENTS"/e-*; do
  test ! -e "$oa_test_record" || oa_idle_relay_line "$oa_test_record" 0
done`,
    async (root, state, { exitCode, stdout }) => {
      const calls = await lines(join(state, 'calls'));
      const path = join(root, 'run/storage.json');
      const stateText = await readFile(path, 'utf8').catch(() => '');

      return {
        exitCode,
        calls,
        attempts: calls
          .filter((call) => call.startsWith('adapter '))
          .map((call) => call.slice('adapter '.length)),
        descriptors: await lines(join(state, 'descriptors')),
        stateText,
        ...(stateText
          ? {
              state: parseState(stateText),
              stateMode: (await stat(path)).mode & 0o777,
            }
          : {}),
        log: stdout.split('\n').filter((line) => line !== ''),
        notes: await lines(join(root, 'work/notes')),
      };
    },
  );
}

/**
 * runs the governor's tick with its idle work and the watcher standing in,
 * each logging that it ran
 * @param scenario the provider's keep-awake mode and whether the watcher is installed
 * @returns what ran, in order
 */
export async function runGovernorTick(
  scenario: TickScenario,
): Promise<string[]> {
  return runGovernor(
    async (root) => {
      await writeFile(join(root, 'run/governor.lock'), '');
      if (scenario.hasWatcher) {
        await writeFile(
          join(root, 'storage.sh'),
          'oa_storage_watch() { echo "watch $1"; }\n',
        );
      }
    },
    async (root) => `set -u
OA_IDLE_LOCK=$OA_IDLE_RUN/governor.lock
OA_IDLE_LOCK_WAIT=3
OA_IDLE_STORAGE='${join(root, 'storage.sh')}'
OA_IDLE_STORAGE_LOCK=$OA_IDLE_RUN/storage.lock
${await governorSource(['oa_idle_setting', 'oa_idle_storage', 'oa_idle_tick'])}
oa_idle_now() { echo 1000; }
oa_idle_settings() {
  echo '{"provider":{"keepAwakeMode":"${scenario.keepAwakeMode}"}}' >"$OA_IDLE_WORK/settings.json"
}
oa_idle_locked() { echo "locked $*"; return 1; }
oa_idle_lock_failure=
oa_idle_recompute() { echo "recompute $*"; }
oa_idle_tick`,
    async (_root, _state, { stdout }) =>
      stdout.split('\n').filter((line) => line !== ''),
  );
}

/**
 * renders one awake event record as the relay does
 * @param record the fields an event leaves, separated by spaces
 * @param owner the id of the account that owns the record
 * @returns the line the relay writes to the machine's log, or undefined when it refuses the record
 */
export async function relayLine(
  record: string,
  owner: number,
): Promise<string | undefined> {
  return runGovernor(
    async (root) => writeFile(join(root, 'events/e-record'), `${record}\n`),
    async () => `${await governorSource(['oa_idle_relay_line'])}
oa_idle_relay_line "$OA_IDLE_EVENTS/e-record" ${String(owner)}`,
    async (_root, _state, { exitCode, stdout }) =>
      exitCode === 0 ? stdout.trim() : undefined,
  );
}
