import type { ProviderCapabilities } from '#domain/declarations';

/** the capability axes of a Fly Sprite */
export const SPRITE_CAPABILITIES: ProviderCapabilities = {
  guestChannel: 'provider-exec',
  keepAwakeMode: 'native-deadline',
  idleForms: ['provider-managed'],
  wakeMode: 'url-traffic',
  supportsCliWakeSleep: false,
  // the Sprite API keeps a task at most an hour
  maxAwakeDeadlineMinutes: 60,
  persistence: 'provider-disk',
  exposure: 'provider-url',
  discovery: 'provider-metadata',
};
