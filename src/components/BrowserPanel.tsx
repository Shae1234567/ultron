import { useCallback, useEffect, useRef, useState } from 'react';
import { Overlay } from './Overlay';

// Electron's <webview> tag is only rendered when `webviewTag: true` is set in
// electron/main.ts's webPreferences for the BrowserWindow. If this panel opens
// but stays blank, that flag is the first thing to check.

// @types/react already declares the `webview` intrinsic element (with Electron's
// real WebViewHTMLAttributes) - no local augmentation needed here.

/** Structural shape covering only the imperative methods/events this panel uses. */
type WebviewEl = HTMLElement & {
  loadURL: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  getURL: () => string;
  getTitle: () => string;
};

const DEFAULT_URL = 'https://www.google.com';

/**
 * Turns whatever the operator typed in the address bar into a navigable URL.
 * A bare domain-looking string gets `https://` prefixed; anything else is
 * treated as a Google search query.
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_URL;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;

  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(trimmed);
  if (looksLikeDomain) return `https://${trimmed}`;

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
  const webviewRef = useRef<WebviewEl>(null);
  const [addressValue, setAddressValue] = useState(DEFAULT_URL);
  const [pageTitle, setPageTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;

    const onStartLoading = () => setLoading(true);
    const onStopLoading = () => {
      setLoading(false);
      const anyEl = el as unknown as { canGoBack?: () => boolean; canGoForward?: () => boolean };
      if (typeof anyEl.canGoBack === 'function') setCanGoBack(anyEl.canGoBack());
      if (typeof anyEl.canGoForward === 'function') setCanGoForward(anyEl.canGoForward());
    };
    const onNavigate = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) setAddressValue(url);
    };
    const onTitleUpdated = (e: Event) => {
      const title = (e as unknown as { title?: string }).title;
      if (title) setPageTitle(title);
    };

    el.addEventListener('did-start-loading', onStartLoading);
    el.addEventListener('did-stop-loading', onStopLoading);
    el.addEventListener('did-navigate', onNavigate);
    el.addEventListener('did-navigate-in-page', onNavigate);
    el.addEventListener('page-title-updated', onTitleUpdated);

    return () => {
      el.removeEventListener('did-start-loading', onStartLoading);
      el.removeEventListener('did-stop-loading', onStopLoading);
      el.removeEventListener('did-navigate', onNavigate);
      el.removeEventListener('did-navigate-in-page', onNavigate);
      el.removeEventListener('page-title-updated', onTitleUpdated);
    };
  }, []);

  const navigateTo = useCallback((raw: string) => {
    const url = normalizeUrl(raw);
    webviewRef.current?.loadURL(url);
  }, []);

  const onAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigateTo(addressValue);
  };

  return (
    <Overlay title="Browser" meta={pageTitle || undefined} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button
            className="hud-btn"
            onClick={() => webviewRef.current?.goBack()}
            disabled={!canGoBack}
            title="Back"
          >
            ◀
          </button>
          <button
            className="hud-btn"
            onClick={() => webviewRef.current?.goForward()}
            disabled={!canGoForward}
            title="Forward"
          >
            ▶
          </button>
          <button
            className="hud-btn"
            onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}
            title={loading ? 'Stop' : 'Reload'}
          >
            {loading ? '✕' : '⟳'}
          </button>

          <input
            className="hud-input"
            style={{ flex: 1 }}
            value={addressValue}
            onChange={(e) => setAddressValue(e.target.value)}
            onKeyDown={onAddressKeyDown}
            spellCheck={false}
            placeholder="Enter a URL or search..."
          />

          <span
            className={`dot ${loading ? 'dot--live' : ''}`}
            style={{ color: loading ? 'var(--cyan)' : 'var(--dimmer)' }}
            title={loading ? 'Loading...' : 'Idle'}
          />
        </div>

        {loading && (
          <div className="browser-loadbar" aria-hidden="true">
            <div className="browser-loadbar__fill holo-border-anim" />
          </div>
        )}

        <div className="holo-panel" style={{ flex: 1, minHeight: 0, position: 'relative', border: '1px solid var(--cyan-20)', overflow: 'hidden' }}>
          {/* webviewTag: true must be set in electron/main.ts's webPreferences
              for this element to actually render a browser frame - if the
              panel is blank, check that flag first. */}
          <webview
            ref={webviewRef}
            src={DEFAULT_URL}
            style={{ width: '100%', height: '100%', display: 'flex' }}
          />
          {loading && (
            <div className="browser-scanning" aria-hidden="true">
              <div className="browser-scanning__ring" />
              <div className="browser-scanning__label mono">FETCHING SIGNAL...</div>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}
