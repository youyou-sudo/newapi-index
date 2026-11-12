import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveNewApiDashboardHref } from '../host-links'

const ENV_KEY = 'VITE_NEWAPI_DASHBOARD_URL'

describe('resolveNewApiDashboardHref', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env[ENV_KEY]
  })

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = original
  })

  it('falls back to the shared-origin /dashboard path when unset', () => {
    delete process.env[ENV_KEY]
    expect(resolveNewApiDashboardHref()).toBe('/dashboard')
  })

  it('uses the configured absolute console URL', () => {
    process.env[ENV_KEY] = 'https://console.example.com/dashboard'
    expect(resolveNewApiDashboardHref()).toBe('https://console.example.com/dashboard')
  })

  it('trims surrounding whitespace', () => {
    process.env[ENV_KEY] = '  https://console.example.com/dashboard  '
    expect(resolveNewApiDashboardHref()).toBe('https://console.example.com/dashboard')
  })

  it('treats blank values as unset', () => {
    process.env[ENV_KEY] = '   '
    expect(resolveNewApiDashboardHref()).toBe('/dashboard')
  })

  it('re-reads the environment on every call (no import-time freezing)', () => {
    process.env[ENV_KEY] = 'https://one.example.com/dashboard'
    expect(resolveNewApiDashboardHref()).toBe('https://one.example.com/dashboard')
    process.env[ENV_KEY] = 'https://two.example.com/dashboard'
    expect(resolveNewApiDashboardHref()).toBe('https://two.example.com/dashboard')
  })
})
