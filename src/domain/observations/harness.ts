// the plugin evidence kinds a harness reports and an ACP agent compares; an
// agent chooses its comparison by `kind`, never by harness identity

/** plugin evidence of a harness that reports the commands its plugins register */
export interface HarnessCommandEvidence {
  /** evidence discriminator */
  kind: 'commands';
  /** commands the harness registered after loading its plugins */
  commands: string[];
  /** whether every selected plugin was loaded */
  selectedPluginsLoaded: boolean;
}

/** probe evidence an ACP agent compares with what it discovered, of any supported kind */
export type HarnessPluginEvidence = HarnessCommandEvidence;

/** non-secret native harness configuration and authentication evidence */
export interface NativeHarnessInspection {
  /** the native plugin inventory command succeeded */
  pluginListAvailable: boolean;
  /** every exact idle-governor awake command the harness driver owns is installed in its hooks */
  awakeHooksInstalled: boolean;
  /** how the harness authenticates */
  authentication: 'native' | 'not-configured';
}

/** current native state of one harness, observed without a model turn */
export interface HarnessInspection<
  Evidence extends HarnessPluginEvidence | undefined =
    HarnessPluginEvidence | undefined,
> {
  /** non-secret configuration and authentication evidence */
  configuration: NativeHarnessInspection;
  /** plugin identities open-agent manages natively */
  selectedPlugins: string[];
  /** the native inventory confirms every selected plugin is installed and enabled */
  pluginsEnabled: boolean;
  /** probe evidence an ACP agent compares with what it loaded */
  evidence: Evidence;
}
