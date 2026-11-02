import type { WorkstationProfile } from '#domain/profile';

/** resolved create/setup values. Management credentials must remain on the caller */
export interface ResolvedInputs {
  name?: string;
  /** management credential of the selected provider */
  providerToken?: string;
  /** driver selection this run resolved */
  profile: WorkstationProfile;
  sources: Record<string, string>;
  missing: string[];
}

/** inputs a workflow needs before its first remote mutation */
export type RequiredInput = 'name' | 'providerToken';
