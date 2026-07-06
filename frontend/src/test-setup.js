import '@testing-library/jest-dom'

// jsdom doesn't implement matchMedia; several pages/components read it (dark mode
// detection, etc.) so stub a "no preference matched" implementation for tests.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })
}
