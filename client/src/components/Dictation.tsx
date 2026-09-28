import { useEffect, useRef, useState } from 'react';

// Browser speech recognition (Chrome, Edge, Safari). Appends what it hears to
// the field; the physician can keep editing while it listens.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => Recognition) | null;
}

export function DictationButton({ onText }: { onText: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const wantOn = useRef(false);
  const Ctor = getRecognition();

  useEffect(() => () => {
    wantOn.current = false;
    rec.current?.stop();
  }, []);

  if (!Ctor) return null;

  function start() {
    setError('');
    const r = new Ctor!();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      let finalText = '';
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else pending += res[0].transcript;
      }
      if (finalText) onText(finalText.trim());
      setInterim(pending);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed') {
        setError('Microphone permission was denied.');
        wantOn.current = false;
      }
    };
    // Browsers end recognition after a pause; restart while the user wants it on
    r.onend = () => {
      setInterim('');
      if (wantOn.current) r.start();
      else setListening(false);
    };
    rec.current = r;
    wantOn.current = true;
    r.start();
    setListening(true);
  }

  function stop() {
    wantOn.current = false;
    rec.current?.stop();
    setListening(false);
  }

  return (
    <span className="dictation">
      <button type="button" className={`btn small ${listening ? 'danger' : 'ghost'}`} onClick={listening ? stop : start}>
        <span className={`mic ${listening ? 'live' : ''}`} aria-hidden /> {listening ? 'Stop dictation' : 'Dictate'}
      </button>
      {interim && <span className="interim">{interim}</span>}
      {error && <span className="error-text">{error}</span>}
    </span>
  );
}

export function appendText(existing: string, addition: string) {
  if (!existing) return addition;
  return existing + (/\s$/.test(existing) ? '' : ' ') + addition;
}
