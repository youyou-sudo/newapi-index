import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { hostThemeInitScript } from '~/lib/theme'

interface HarnessOptions {
  search?: string
  prefersDark?: boolean
  embedded?: boolean
}

interface MessageEventLike {
  source: unknown
  data: unknown
}

function createHarness(options: HarnessOptions = {}) {
  const classes = new Set<string>()
  const attributes = new Map<string, string>()
  const messageListeners: Array<(event: MessageEventLike) => void> = []
  const mediaListeners: Array<() => void> = []

  const root = {
    classList: {
      toggle(name: string, force?: boolean) {
        if (force) classes.add(name)
        else classes.delete(name)
      },
    },
    style: {} as { colorScheme?: string },
    setAttribute(name: string, value: string) {
      attributes.set(name, value)
    },
    removeAttribute(name: string) {
      attributes.delete(name)
    },
  }

  const media = {
    matches: options.prefersDark ?? false,
    addEventListener(_type: 'change', listener: () => void) {
      mediaListeners.push(listener)
    },
  }

  const windowObject: Record<string, unknown> = {
    location: { search: options.search ?? '' },
    matchMedia: () => media,
    addEventListener(type: string, listener: (event: MessageEventLike) => void) {
      if (type === 'message') messageListeners.push(listener)
    },
  }
  windowObject.parent = options.embedded ? {} : windowObject

  runInNewContext(hostThemeInitScript, {
    window: windowObject,
    document: { documentElement: root },
    URLSearchParams,
    setTimeout,
  })

  const send = (event: MessageEventLike) => {
    for (const listener of messageListeners) listener(event)
  }
  const changeSystem = () => {
    for (const listener of mediaListeners) listener()
  }

  return { classes, attributes, send, changeSystem, media, windowObject, root }
}

describe('host theme bootstrap', () => {
  it('follows a dark system preference when opened standalone', () => {
    const harness = createHarness({ prefersDark: true })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.root.style.colorScheme).toBe('dark')
    expect(harness.windowObject.parent).toBe(harness.windowObject)
    expect(harness.attributes.get('data-host-theme')).toBe('system')
  })

  it('follows a light system preference when opened standalone', () => {
    const harness = createHarness({ prefersDark: false })

    expect(harness.classes.has('dark')).toBe(false)
    expect(harness.root.style.colorScheme).toBe('light')
  })

  it('applies the ?theme=dark override on a light system', () => {
    const harness = createHarness({ prefersDark: false, search: '?theme=dark' })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.attributes.get('data-host-theme')).toBe('dark')
  })

  it('paints immediately while embedded and never hides the body', () => {
    // The host sends themeMode on iframe onLoad, which is later than first paint.
    // The bootstrap must therefore render in the system theme right away and
    // must not install any visibility mask (that is what made the page appear
    // only after every resource had loaded).
    const harness = createHarness({ embedded: true, prefersDark: true })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.attributes.has('data-host-theme-pending')).toBe(false)
  })

  it('applies the host theme when it arrives after first paint', () => {
    const harness = createHarness({ embedded: true, prefersDark: false })
    expect(harness.classes.has('dark')).toBe(false)

    harness.send({ source: harness.windowObject.parent, data: { themeMode: 'dark' } })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.root.style.colorScheme).toBe('dark')
    expect(harness.attributes.get('data-host-theme')).toBe('dark')
  })

  it('treats an explicit ?theme= as authoritative over the host', () => {
    const harness = createHarness({
      embedded: true,
      prefersDark: false,
      search: '?theme=dark',
    })

    harness.send({ source: harness.windowObject.parent, data: { themeMode: 'light' } })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.attributes.get('data-host-theme')).toBe('dark')
  })

  it('applies later theme switches from the host', () => {
    const harness = createHarness({ embedded: true, prefersDark: false })
    harness.send({ source: harness.windowObject.parent, data: { themeMode: 'dark' } })
    harness.send({ source: harness.windowObject.parent, data: { themeMode: 'light' } })

    expect(harness.classes.has('dark')).toBe(false)
  })

  it('accepts a plain string payload and the generic theme field', () => {
    const harness = createHarness({ embedded: true })
    harness.send({ source: harness.windowObject.parent, data: 'dark' })
    expect(harness.classes.has('dark')).toBe(true)

    harness.send({ source: harness.windowObject.parent, data: { theme: 'light' } })
    expect(harness.classes.has('dark')).toBe(false)
  })

  it('ignores messages from another window and malformed payloads', () => {
    const harness = createHarness({ embedded: true, prefersDark: false })

    harness.send({ source: {}, data: { themeMode: 'dark' } })
    harness.send({ source: harness.windowObject.parent, data: { themeMode: 'purple' } })
    harness.send({ source: harness.windowObject.parent, data: null })

    expect(harness.classes.has('dark')).toBe(false)
    expect(harness.attributes.get('data-host-theme')).toBe('system')
  })

  it('keeps the host theme when the system preference changes', () => {
    const harness = createHarness({ embedded: true, prefersDark: false })
    harness.send({ source: harness.windowObject.parent, data: { themeMode: 'light' } })

    harness.media.matches = true
    harness.changeSystem()

    expect(harness.classes.has('dark')).toBe(false)
  })

  it('updates with the system preference while no host theme was received', () => {
    const harness = createHarness({ embedded: true, prefersDark: false })

    harness.media.matches = true
    harness.changeSystem()

    expect(harness.classes.has('dark')).toBe(true)
  })
})
