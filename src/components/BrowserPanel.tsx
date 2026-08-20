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

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
  const webviewRef = useRef<WebviewEl>(null);
  const [addressValue, setAddressValue] = useState(DEFAULT_URL);
  const [pageTitle, setPageTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [focused, setFocused] = useState(false);

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
    <Overlay title="Net Uplink" meta={pageTitle ? pageTitle.slice(0, 40) : hostOf(addressValue)} onClose={onClose}>
      <div className="bwp-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 520 }}>
        <style>{`
          .bwp-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            margin-bottom: 10px;
            background: linear-gradient(180deg, rgba(0,217,255,0.07), transparent);
            border: 1px solid var(--cyan-20);
            clip-path: polygon(0 6px, 6px 0, 100% 0, 100% 100%, 6px 100%, 0 calc(100% - 6px));
          }
          .bwp-navbtn {
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--cyan-20);
            background: rgba(0,217,255,0.04);
            color: var(--cyan);
            cursor: pointer;
            transition: background 0.15s, border-color 0.15s, color 0.15s;
            flex: 0 0 auto;
          }
          .bwp-navbtn:hover:not(:disabled) {
            background: rgba(0,217,255,0.14);
            border-color: var(--cyan-55);
            color: var(--white);
          }
          .bwp-navbtn:disabled { opacity: 0.3; cursor: default; }
          .bwp-navbtn svg { width: 14px; height: 14px; }

          .bwp-addr {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 7px;
            height: 30px;
            padding: 0 10px;
            background: var(--void);
            border: 1px solid var(--cyan-20);
            transition: border-color 0.15s, box-shadow 0.15s;
          }
          .bwp-addr--focused { border-color: var(--cyan-55); box-shadow: 0 0 10px rgba(0,217,255,0.25); }
          .bwp-addr__lock { color: var(--cyan); flex: 0 0 auto; display: flex; }
          .bwp-addr__lock svg { width: 11px; height: 11px; }
          .bwp-addr__input {
            flex: 1;
            min-width: 0;
            background: none;
            border: none;
            outline: none;
            color: var(--white);
            font-family: var(--font-mono);
            font-size: 12px;
            letter-spacing: 0.02em;
          }
          .bwp-addr__input::placeholder { color: var(--dim); }
          .bwp-addr__status {
            flex: 0 0 auto;
            font-family: var(--font-mono);
            font-size: 8.5px;
            letter-spacing: 0.1em;
            color: var(--dimmer);
          }
          .bwp-addr__status--live { color: var(--cyan); text-shadow: 0 0 6px rgba(0,217,255,0.5); }

          .bwp-frame {
            flex: 1;
            min-height: 0;
            position: relative;
            border: 1px solid var(--cyan-20);
            overflow: hidden;
            box-shadow: inset 0 0 24px rgba(0,217,255,0.06);
          }
          .bwp-frame__corner {
            position: absolute;
            width: 14px;
            height: 14px;
            border: 1.5px solid var(--cyan-55);
            z-index: 2;
            pointer-events: none;
            opacity: 0.85;
          }
          .bwp-frame__corner--tl { top: -1px; left: -1px; border-right: none; border-bottom: none; }
          .bwp-frame__corner--tr { top: -1px; right: -1px; border-left: none; border-bottom: none; }
          .bwp-frame__corner--bl { bottom: -1px; left: -1px; border-right: none; border-top: none; }
          .bwp-frame__corner--br { bottom: -1px; right: -1px; border-left: none; border-top: none; }
        `}</style>

        <div className="bwp-toolbar">
          <button className="bwp-navbtn" onClick={() => webviewRef.current?.goBack()} disabled={!canGoBack} title="Back">
            <svg viewBox="0 0 16 16" fill="none"><path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="bwp-navbtn" onClick={() => webviewRef.current?.goForward()} disabled={!canGoForward} title="Forward">
            <svg viewBox="0 0 16 16" fill="none"><path d="M6 3 L11 8 L6 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button
            className="bwp-navbtn"
            onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}
            title={loading ? 'Stop' : 'Reload'}
          >
            {loading ? (
              <svg viewBox="0 0 16 16" fill="none"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 1 1-1.6-3.66M13 3v3.4h-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </button>

          <div className={`bwp-addr ${focused ? 'bwp-addr--focused' : ''}`}>
            <span className="bwp-addr__lock">
              <svg viewBox="0 0 16 16" fill="none"><rect x="3.5" y="7" width="9" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.2" /></svg>
            </span>
            <input
              className="bwp-addr__input"
              value={addressValue}
              onChange={(e) => setAddressValue(e.target.value)}
              onKeyDown={onAddressKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              spellCheck={false}
              placeholder="Search Google or enter a URL..."
            />
            <span className={`bwp-addr__status ${loading ? 'bwp-addr__status--live' : ''}`}>
              {loading ? 'LINK ACTIVE' : 'IDLE'}
            </span>
          </div>
        </div>

        {loading && (
          <div className="browser-loadbar" aria-hidden="true">
            <div className="browser-loadbar__fill holo-border-anim" />
          </div>
        )}

        <div className="bwp-frame">
          <span className="bwp-frame__corner bwp-frame__corner--tl" />
          <span className="bwp-frame__corner bwp-frame__corner--tr" />
          <span className="bwp-frame__corner bwp-frame__corner--bl" />
          <span className="bwp-frame__corner bwp-frame__corner--br" />
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
