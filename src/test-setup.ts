/**
 * Global test setup.
 *
 * jsdom (the default environment for `ng test`) does not implement
 * `window.matchMedia`, which ThemeService calls in its constructor to read the
 * OS dark-mode preference. Without this stub, any test that instantiates a
 * component pulling in ThemeService fails before its assertions run.
 *
 * The stub reports light mode and accepts listeners without ever firing them,
 * which matches what a test environment with no OS preference should look like.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string): MediaQueryList => {
    const list: MediaQueryList = {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
      // Deprecated API kept for libraries that still call it.
      addListener: () => undefined,
      removeListener: () => undefined,
    };
    return list;
  }) as typeof window.matchMedia;
}
