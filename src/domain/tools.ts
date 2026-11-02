import type { OsConstraint, OsFamilyId } from '#domain/guest';

/** the guest account that owns a tool's files: root for system packages, `linuxbrew` for Homebrew, the agent for its own */
export type ToolOwner = 'root' | 'linuxbrew' | 'agent';

/** a Homebrew formula, owned by `linuxbrew` */
export interface BrewToolSource {
  /** source discriminator */
  kind: 'brew';
  /** formula name */
  formula: string;
  /** tap the formula comes from; absent for homebrew/core */
  tap?: string;
  /** directories of the keg, relative to its prefix, whose executables are linked; `bin` when absent */
  binDirs?: readonly string[];
  /** where the source is usable */
  when?: OsConstraint;
}

/** packages of one family's system package manager, owned by root */
export interface SystemToolSource {
  /** source discriminator */
  kind: 'system';
  /** family whose package manager installs the packages */
  family: OsFamilyId;
  /** package names */
  packages: readonly string[];
  /** where the source is usable */
  when?: OsConstraint;
}

/** an npm package the agent installs with Homebrew's `node` */
export interface NpmToolSource {
  /** source discriminator */
  kind: 'npm';
  /** registry package name */
  package: string;
  /** the agent owns its npm tools */
  account: 'agent';
}

/** a Rust toolchain the agent installs with rustup */
interface RustupToolSource {
  /** source discriminator */
  kind: 'rustup';
  /** toolchain, such as `stable` */
  toolchain: string;
  /** components installed with the toolchain */
  components: readonly string[];
  /** the agent owns its toolchains */
  account: 'agent';
}

/** where one tool can be installed from */
export type ToolSource =
  BrewToolSource | SystemToolSource | NpmToolSource | RustupToolSource;

/** the command whose output reports a tool's installed version */
export interface ToolVersionProbe {
  /** program, by name or absolute path */
  executable: string;
  /** program arguments */
  args: readonly string[];
  /** account the probe runs as */
  account: ToolOwner;
  /** additional environment variables */
  environment?: Readonly<Record<string, string>>;
}

/** one tool, from the base set or contributed by a driver, and every way it can be installed */
export interface ToolSpec {
  /** tool name, unique across the workstation */
  name: string;
  /** setup refuses without it; an optional tool with no usable source is skipped and recorded */
  required: boolean;
  /** tools installed first, such as `node` for an npm tool */
  needs?: readonly string[];
  /** executables a `brew` source links into `/usr/local/bin` */
  executables: readonly string[];
  /** version probe */
  version: ToolVersionProbe;
  /** sources in preference order */
  sources: readonly [ToolSource, ...ToolSource[]];
}

/** the source a resolver picked for a tool, or why none is usable */
export type Resolution =
  | {
      /** tool name */
      tool: string;
      /** the first usable source */
      source: ToolSource;
    }
  | {
      /** tool name */
      tool: string;
      /** why no source is usable */
      unavailable: string;
    };

/** a source the guest turned down after resolution, such as a formula with no bottle for its architecture */
export interface RefusedSource {
  /** tool name */
  tool: string;
  /** the source turned down */
  source: ToolSource;
  /** why, as reported to the user */
  reason: string;
}
