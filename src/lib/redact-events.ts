/**
 * Redact 0.1.x event-surface shim.
 *
 * Redact passes the native DOM event to handlers and only aliases
 * `event.nativeEvent`. Its TypeScript declares the React SyntheticEvent helpers
 * (`isDefaultPrevented`, `isPropagationStopped`, `persist`) but the runtime does
 * not add them. Libraries legitimately feature-detect/call those helpers on the
 * event they receive; Radix Select calls `event.isPropagationStopped()` when an
 * item is selected, which throws
 * "TypeError: e.isPropagationStopped is not a function" and keeps the dropdown
 * from committing the new sort.
 *
 * Restore the missing React-shaped surface on native events. This is a no-op
 * under real React (SyntheticEvent defines its own methods) and on the server
 * (no DOM Event). Remove once @tanstack/redact implements the declared methods;
 * the guard below makes a future implementation win.
 */
export function installRedactEventCompat(): void {
  // Client only: Node 25 also exposes a global `Event` (Web API), but the
  // SyntheticEvent surface is only needed by DOM event handlers in the browser.
  if (typeof window === 'undefined' || typeof Event === 'undefined') return

  const prototype = Event.prototype as Event & {
    isDefaultPrevented?: () => boolean
    isPropagationStopped?: () => boolean
    persist?: () => void
  }

  // Already provided (real React's SyntheticEvent does not patch this prototype,
  // but a future Redact release will): never override an implementation.
  if (
    typeof prototype.isPropagationStopped === 'function' &&
    typeof prototype.isDefaultPrevented === 'function'
  ) {
    return
  }

  const propagationStopped = new WeakSet<Event>()
  const nativeStopPropagation = prototype.stopPropagation

  prototype.stopPropagation = function stopPropagation(this: Event) {
    propagationStopped.add(this)
    nativeStopPropagation.call(this)
  }

  if (typeof prototype.isPropagationStopped !== 'function') {
    prototype.isPropagationStopped = function isPropagationStopped(this: Event) {
      return propagationStopped.has(this)
    }
  }

  if (typeof prototype.isDefaultPrevented !== 'function') {
    prototype.isDefaultPrevented = function isDefaultPrevented(this: Event) {
      return this.defaultPrevented
    }
  }

  if (typeof prototype.persist !== 'function') {
    // Native events are not pooled, so there is nothing to retain.
    prototype.persist = function persist() {}
  }
}
