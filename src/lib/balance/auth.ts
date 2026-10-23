export const DEFAULT_AUTH_SCHEME = 'Bearer'

/**
 * Relay stations accept their API key as a default Bearer credential.
 * Keep the stored value as a raw key; tolerate an already-prefixed value.
 */
export function relayAuthorizationHeader(apiKey: string): string {
  const key = apiKey.trim().replace(/^Bearer\s+/i, '')
  return `${DEFAULT_AUTH_SCHEME} ${key}`
}
