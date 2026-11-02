import type { IdleForm, KeepAwakeMode, WakeMode } from '#domain/declarations';
import type { OsFamilyId } from '#domain/guest';
import type { GuestAccount, GuestCommand } from '#domain/guest-command';
import type { WorkstationProfile } from '#domain/profile';
import type { ServiceDefinition } from '#domain/services';
import type { ToolOwner, ToolSource } from '#domain/tools';

/** the record's format version */
export type EnvironmentSchema = 1;

/** how the last setup ended: `incomplete` when a critical step failed */
export type EnvironmentSetupState = 'ready' | 'incomplete';

/** one installed tool and the source setup resolved for it */
export interface EnvironmentTool {
  /** tool name */
  name: string;
  /** whether setup refuses without it */
  required: boolean;
  /** account that owns the tool's files, which its source decides */
  account: ToolOwner;
  /** executables a `brew` tool links into `/usr/local/bin` */
  executables: readonly string[];
  /** the resolved source */
  source: ToolSource;
  /** the version the source's manager reports installed, which setup records; absent for a system tool or one whose version cannot be read */
  version?: string;
}

/** an optional tool setup skipped since no source of it is usable */
export interface SkippedTool {
  /** tool name */
  name: string;
  /** why no source is usable */
  reason: string;
}

/** the provider's facts the idle governor and its awake adapter read */
export interface EnvironmentProvider {
  /** provider identifier */
  id: string;
  /** who decides when the workstation sleeps */
  keepAwakeMode: KeepAwakeMode;
  /** idle forms in preference order */
  idleForms: readonly IdleForm[];
  /** how a sleeping workstation is woken */
  wakeMode: WakeMode;
  /** a cli-restore provider opts in to governor-initiated sleep */
  supportsCliWakeSleep: boolean;
  /** furthest ahead, in minutes, one deadline keeps the workstation awake; null when unlimited */
  maxAwakeDeadlineMinutes: number | null;
  /** minutes without heartbeat or hold before sleep, capped at the deadline limit; 0 never sleeps */
  idleTimeoutMinutes: number;
  /** minutes a turn hold lasts after its last refresh, capped at the deadline limit */
  holdMaxMinutes: number;
  /** where the provider's awake adapter is installed; null when it deploys none */
  awakeAdapter: string | null;
}

/** a command recorded for a guest program to run */
type EnvironmentCommand = Pick<
  GuestCommand,
  'program' | 'arguments' | 'account' | 'environment'
>;

/** one selected harness, as the agent's launcher passes it on */
export interface EnvironmentHarness {
  /** harness identifier */
  id: string;
  /** environment the agent passes when spawning the harness */
  environment: Readonly<Record<string, string>>;
  /** the ACP adapter the harness provides, when it provides one */
  adapter?: {
    /** the adapter's tool name in `tools` */
    tool: string;
    /** command the agent runs to launch the adapter */
    launch: EnvironmentCommand;
  };
}

/** the selected ACP agent, as its launcher starts it */
interface EnvironmentAgent {
  /** agent identifier */
  id: string;
  /** name of the agent's service in `services` */
  service: string;
  /** account the agent runs as */
  account: GuestAccount;
  /** port the agent listens on and the provider routes to */
  port: number;
  /** the selected harnesses, in selection order */
  harnesses: readonly EnvironmentHarness[];
}

/** the record setup leaves at `/opt/open-agent/environment.json` */
export interface GuestEnvironment {
  /** format version */
  schema: EnvironmentSchema;
  /** the open-agent release that last set the guest up */
  openAgent: {
    /** its version; destroy refuses a guest a newer release set up */
    version: string;
    /** when it finished, as an ISO 8601 timestamp */
    setupAt: string;
  };
  /** how the last setup ended, and the optional tools it skipped */
  setup: {
    /** `incomplete` when a critical step failed */
    state: EnvironmentSetupState;
    /** optional tools with no usable source */
    skipped: readonly SkippedTool[];
  };
  /** the guest's OS */
  os: {
    /** family whose library setup sources */
    family: OsFamilyId;
  };
  /** the workstation's profile */
  profile: WorkstationProfile;
  /** the installed tools */
  tools: readonly EnvironmentTool[];
  /** the provider's facts */
  provider: EnvironmentProvider;
  /** the agent's launch facts */
  agent: EnvironmentAgent;
  /** the services the provider runs, the agent's included */
  services: readonly ServiceDefinition[];
}
