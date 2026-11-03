import { inspect } from 'node:util';

/**
 * where the host obtained a credential it hands to the guest; `embedded` is
 * guest file contents that hold one
 */
type HostCredentialSource = 'embedded';

/** source and registered value held by one secret */
interface SecretParams {
  source: HostCredentialSource;
  value: string;
}

const REDACTED = '[REDACTED]';

/** the value of each secret, kept off the object so no enumeration reaches it */
const values = new WeakMap<Secret, string>();

/**
 * a credential on its way to the guest: built only from a host credential
 * source, registered for redaction, and printed, serialised and inspected as
 * a redaction marker. Only the session framing reads its value
 */
export class Secret {
  /** where the host obtained the credential */
  public readonly source: HostCredentialSource;

  /**
   * holds a credential already registered for redaction
   * @param params source and value of the credential
   * @param params.source where the host obtained the credential
   * @param params.value credential stored outside enumerable properties
   */
  private constructor({ source, value }: SecretParams) {
    this.source = source;
    values.set(this, value);
  }

  /**
   * wraps guest file contents that hold a credential the host resolved; the
   * credential within is registered for redaction already, so the contents are not
   * @param contents file contents that hold a resolved credential
   * @returns the contents, delivered only as a secret
   */
  public static embedding(contents: string): Secret {
    return new Secret({ source: 'embedded', value: contents });
  }

  /**
   * withholds the value from string conversion
   * @returns the redaction marker
   */
  public toString(): string {
    return REDACTED;
  }

  /**
   * withholds the value from serialisation
   * @returns the redaction marker
   */
  public toJSON(): string {
    return REDACTED;
  }

  /**
   * withholds the value from `util.inspect` and console output
   * @returns the source and the redaction marker
   */
  public [inspect.custom](): string {
    return `Secret(${this.source}) ${REDACTED}`;
  }
}

/**
 * reads a secret's value for delivery to the guest; only the session framing
 * calls it, and the value never leaves the session's standard input
 * @param secret a credential built by {@link Secret.embedding}
 * @returns its value
 * @throws {Error} when the value was not built by {@link Secret.embedding}
 */
export function revealSecret(secret: Secret): string {
  const value = values.get(secret);
  if (value === undefined) {
    throw new Error('Not a secret built from a host credential source');
  }

  return value;
}
