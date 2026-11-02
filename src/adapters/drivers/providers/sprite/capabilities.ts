import type { ProviderCapabilities } from '#domain/declarations';

/** the capability axes of a Fly Sprite */
export const SPRITE_CAPABILITIES: ProviderCapabilities = {
  guestChannel: 'provider-exec',
  persistence: 'provider-disk',
  exposure: 'provider-url',
  discovery: 'provider-metadata',
};
