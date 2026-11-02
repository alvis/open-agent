// the evidence kinds a harness reports and an ACP agent compares; an agent
// chooses its comparison by `kind`, never by harness identity

/** evidence of a harness that reports the commands it registers */
export interface HarnessCommandEvidence {
  /** evidence discriminator */
  kind: 'commands';
  /** commands the harness registered */
  commands: string[];
}

/** probe evidence an ACP agent compares with what it discovered, of any supported kind */
export type HarnessEvidence = HarnessCommandEvidence;

/** non-secret native harness configuration and authentication evidence */
export interface NativeHarnessInspection {
  /** how the harness authenticates */
  authentication: 'native' | 'not-configured';
}

/** current native state of one harness, observed without a model turn */
export interface HarnessInspection<
  Evidence extends HarnessEvidence | undefined = HarnessEvidence | undefined,
> {
  /** non-secret configuration and authentication evidence */
  configuration: NativeHarnessInspection;
  /** probe evidence an ACP agent compares with what it loaded */
  evidence: Evidence;
}
