import type {
  GuestAsset,
  HomebrewSupport,
  OsFamilyId,
  OsRelease,
} from '#domain/guest';
import type { ToolOwner } from '#domain/tools';

/** a distribution family's layer of host-driven setup, shared by every provider that runs it */
export interface OsFamily {
  /** family identifier */
  id: OsFamilyId;
  /**
   * tells whether an `/etc/os-release` belongs to the family, by `ID` or `ID_LIKE`
   * @param osRelease the parsed `/etc/os-release` fields
   * @returns true when the release is one of the family's
   */
  matches(osRelease: Readonly<Record<string, string>>): boolean;
  /** absolute path of the POSIX shell a session runs, such as `/bin/dash` */
  shell: string;
  /** programs a session needs on the guest before it runs any command */
  sessionCommands: readonly string[];
  /**
   * renders the program prefix that runs a command as an account; empty for
   * root. It stays a program, never a shell function, so it can follow
   * `setsid` and `timeout`
   * @param account account the command runs as
   * @returns program and arguments placed before the command
   */
  runAs(account: ToolOwner): readonly string[];
  /**
   * lists the system packages every setup installs first, cron included
   * @param release the guest's release
   * @returns package names
   */
  bootstrapPackages(release: OsRelease): readonly string[];
  /**
   * tells whether Homebrew runs on a release, architecture and C library
   * @param release the guest's release
   * @returns the support and its prerequisites, or why it is unsupported
   */
  homebrew(release: OsRelease): HomebrewSupport;
  /** the family's helper library, sourced by setup and the updater */
  library: GuestAsset;
  /** the system-package fragment of the updater */
  updaterFragment: GuestAsset;
}

/** what a service setup step is built with */
export interface ServiceStepContext {
  /** the guest's OS family, whose shell every step runs */
  family: Pick<OsFamily, 'shell'>;
  /** ids of the steps that must succeed first, such as the one writing environment.json */
  needs: readonly string[];
}
