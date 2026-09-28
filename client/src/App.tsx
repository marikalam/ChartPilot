import { useCallback, useEffect, useRef, useState } from 'react';
import type { Library, ServerConfig } from './lib/types';
import { checkPasscode, getConfig, setPasscode } from './lib/api';
import { emptyLibrary, loadLibrary, saveLibrary } from './lib/store';
import { ScreenPage, emptyScreen, type ScreenState } from './pages/Screen';
import { WriteUpPage, emptyWriteUp, type WriteUpState } from './pages/WriteUp';
import { LibraryPage } from './pages/Library';

type Tab = 'screen' | 'writeup' | 'library';
const TABS: [Tab, string][] = [
  ['screen', 'Screening'],
  ['writeup', 'Write-up'],
  ['library', 'Library'],
];

function tabFromHash(): Tab {
  const h = location.hash.replace('#', '');
  return (TABS.find(([t]) => t === h)?.[0] ?? 'screen') as Tab;
}

export default function App() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>(tabFromHash);

  // Patient work lives in memory only: it survives switching tabs but is
  // gone on reload, so nothing identifiable lingers on the device.
  const [screen, setScreen] = useState<ScreenState>(emptyScreen);
  const [writeUp, setWriteUp] = useState<WriteUpState>(emptyWriteUp);

  useEffect(() => {
    getConfig()
      .then(async (c) => {
        setConfig(c);
        setUnlocked(!c.passcodeRequired || (await checkPasscode()));
      })
      .catch(() => setConfigError('Could not reach the ChartPilot server.'));
    loadLibrary().then((l) => {
      setLibrary(l);
      setLoaded(true);
    });
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Debounced save of the library to IndexedDB
  const saveTimer = useRef<number | undefined>(undefined);
  const updateLibrary = useCallback((fn: (l: Library) => Library) => {
    setLibrary((prev) => {
      const next = fn(prev);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveLibrary(next).catch(() => alert('Could not save the library in this browser.')), 400);
      return next;
    });
  }, []);

  const go = (t: Tab) => {
    location.hash = t;
    setTab(t);
    window.scrollTo(0, 0);
  };

  if (configError) return <Centered>{configError}</Centered>;
  if (!config || !loaded) return <Centered>Loading…</Centered>;
  if (!unlocked) return <PasscodeGate onUnlock={() => setUnlocked(true)} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo /> ChartPilot
        </div>
        <nav className="tabs">
          {TABS.map(([t, label]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => go(t)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {!config.apiKeyConfigured && (
        <div className="alert warn page-alert">The server has no ANTHROPIC_API_KEY set, so requests will fail. See DEPLOY.md.</div>
      )}

      <main>
        {tab === 'screen' && <ScreenPage library={library} state={screen} setState={setScreen} goLibrary={() => go('library')} />}
        {tab === 'writeup' && (
          <WriteUpPage
            library={library}
            settings={library.settings}
            externalEvidence={config.externalEvidence}
            state={writeUp}
            setState={setWriteUp}
            goLibrary={() => go('library')}
          />
        )}
        {tab === 'library' && (
          <LibraryPage
            library={library}
            update={updateLibrary}
            externalEvidence={config.externalEvidence}
            passcodeRequired={config.passcodeRequired}
          />
        )}
      </main>

      <footer className="footer">
        Decision support only — the physician remains responsible for every disposition and note. Patient text is sent to the Anthropic API to
        generate answers and is not stored by ChartPilot; follow your institution's policy for protected health information.
      </footer>
    </div>
  );
}

function PasscodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return (
    <Centered>
      <form
        className="card gate"
        onSubmit={async (e) => {
          e.preventDefault();
          setPasscode(value);
          if (await checkPasscode()) onUnlock();
          else setError('That passcode is not right.');
        }}
      >
        <div className="brand big">
          <Logo /> ChartPilot
        </div>
        <label>
          Passcode
          <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary block">Unlock</button>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 17h4l2-6 3 11 2-5h3" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
