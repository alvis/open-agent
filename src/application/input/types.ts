import type {
  CredentialSaveResult,
  ManagementCredentialName,
} from '#domain/credentials';
import type { WorkstationProfile } from '#domain/profile';

/** resolved create/setup values. Management credentials must remain on the caller */
export interface ResolvedInputs {
  name?: string;
  /** management credential of the selected provider */
  providerToken?: string;
  /** the provider credential was entered at a prompt in this run and is not saved yet */
  isProviderTokenEntered?: boolean;
  /** driver selection and options this run resolved */
  profile: WorkstationProfile;
  sources: Record<string, string>;
  missing: string[];
  retainedCredentials?: Partial<
    Record<ManagementCredentialName, CredentialSaveResult>
  >;
}

/** inputs a workflow needs before its first remote mutation */
export type RequiredInput = 'name' | 'providerToken';
