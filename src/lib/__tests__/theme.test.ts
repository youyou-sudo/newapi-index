import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  const attributes = new Set<string>()
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
    setAttribute(name: string) {
      attributes.add(name)
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

afterEach(() => {
  vi.useRealTimers()
})

describe('host theme bootstrap', () => {
  it('follows a dark system preference when opened standalone', () => {
    const harness = createHarness({ prefersDark: true })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.root.style.colorScheme).toBe('dark')
    expect(harness.windowObject.parent).toBe(harness.windowObject)
  })

  it('follows a light system preference when opened standalone', () => {
    const harness = createHarness({ prefersDark: false })

    expect(harness.classes.has('dark')).toBe(false)
    expect(harness.attributes.has('data-host-theme-pending')).toBe(false)
  })

  it('applies the ?theme=dark override on a light system', () => {
    const harness = createHarness({ prefersDark: false, search: '?theme=dark' })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.attributes.has('data-host-theme-pending')).toBe(false)
  })

  it('masks the body while embedded until the host theme arrives', () => {
    const harness = createHarness({ embedded: true, prefersDark: false })
    expect(harness.attributes.has('data-host-theme-pending')).toBe(true)

    harness.send({ source: harness.windowObject.parent, data: { themeMode: 'dark' } })

    expect(harness.classes.has('dark')).toBe(true)
    expect(harness.attributes.has('data-host-theme-pending')).toBe(false)
  })

  it('reveals the body after the fallback timeout when no host message arrives', () => {
    vi.useFakeTimers()
    const harness = createHarness({ embedded: true, prefersDark: true })

    expect(harness.attributes.has('data-host-theme-pending')).toBe(true)
    vi.advanceTimersByTime(700)

    expect(harness.attributes.has('data-host-theme-pending')).toBe(false)
    expect(harness.classes.has('dark')).toBe(true)
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
    expect(harness.attributes.has('data-host-theme-pending')).toBe(true)
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
