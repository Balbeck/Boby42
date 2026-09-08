import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useAutoScroll } from '../../../src/hooks/useAutoScroll'

// The whole hook is one deliberate quirk: it IGNORES the first ResizeObserver
// callback. That callback fires on `observe()` with nothing actually resized,
// and honouring it would smooth-scroll to the bottom right after PersistentNav
// restored a saved scroll position — so coming back to a page would silently
// throw the user to the end of a long conversation. Nothing about that is
// visible in the code's shape, which is exactly why it needs a test.

/** @type {{ instances: any[] }} */
const observers = { instances: [] }

beforeEach(() => {
  observers.instances = []

  vi.stubGlobal(
    'ResizeObserver',
    class FakeResizeObserver {
      /** @param {() => void} callback */
      /** @param {() => void} callback */
      constructor(callback) {
        this.callback = callback
        /** @type {Element[]} */
        this.observed = []
        this.disconnected = false
        observers.instances.push(this)
      }

      /** @param {Element} node */
      observe(node) {
        this.observed.push(node)
      }

      disconnect() {
        this.disconnected = true
      }

      /** Fires the callback the way a real resize would. */
      fire() {
        this.callback()
      }
    },
  )
})

afterEach(() => vi.unstubAllGlobals())

/** Renders the hook and attaches it to a real element. */
function mountAttached() {
  const scrollIntoView = vi.fn()
  const view = renderHook(() => useAutoScroll())

  const container = document.createElement('div')
  const bottom = /** @type {any} */ (document.createElement('div'))
  bottom.scrollIntoView = scrollIntoView

  act(() => {
    view.result.current.containerRef(container)
  })
  view.result.current.bottomRef.current = bottom

  return { view, container, bottom, scrollIntoView }
}

describe('useAutoScroll', () => {
  it('observes nothing until a container is attached', () => {
    renderHook(() => useAutoScroll())
    expect(observers.instances).toHaveLength(0)
  })

  it('observes the container the callback ref receives', () => {
    const { container } = mountAttached()

    expect(observers.instances).toHaveLength(1)
    expect(observers.instances[0].observed).toEqual([container])
  })

  it('ignores the first callback — the one `observe()` fires by itself', () => {
    // Honouring it would wipe the scroll position PersistentNav just restored.
    const { scrollIntoView } = mountAttached()

    act(() => observers.instances[0].fire())
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('scrolls on every callback after the first', () => {
    const { scrollIntoView } = mountAttached()

    act(() => observers.instances[0].fire())
    act(() => observers.instances[0].fire())
    act(() => observers.instances[0].fire())

    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' })
  })

  it('does not throw when the bottom sentinel is not mounted yet', () => {
    const view = renderHook(() => useAutoScroll())
    act(() => view.result.current.containerRef(document.createElement('div')))

    act(() => observers.instances[0].fire())
    expect(() => act(() => observers.instances[0].fire())).not.toThrow()
  })

  it('disconnects on unmount', () => {
    const { view } = mountAttached()
    view.unmount()

    expect(observers.instances[0].disconnected).toBe(true)
  })

  it('re-arms the first-callback guard when the container changes', () => {
    // A page switch remounts the container: the new observer's own initial
    // callback must be ignored too, or the restored position is lost again.
    const { view, scrollIntoView } = mountAttached()
    act(() => observers.instances[0].fire())
    act(() => observers.instances[0].fire())
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    act(() => view.result.current.containerRef(document.createElement('div')))
    expect(observers.instances).toHaveLength(2)
    expect(observers.instances[0].disconnected).toBe(true)

    act(() => observers.instances[1].fire())
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('tears down the observer when the container ref is cleared', () => {
    const { view } = mountAttached()
    act(() => view.result.current.containerRef(null))

    expect(observers.instances[0].disconnected).toBe(true)
    expect(observers.instances).toHaveLength(1)
  })

  it('keeps a stable containerRef identity across renders', () => {
    // It is passed as a callback ref; a new identity each render would make
    // React detach and re-attach — firing the initial callback every time.
    const { result, rerender } = renderHook(() => useAutoScroll())
    const first = result.current.containerRef

    rerender()
    expect(result.current.containerRef).toBe(first)
  })
})
