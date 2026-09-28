import { useRef, useState } from 'react';
import { ACCEPTED_FILES, fileToText } from '../lib/extract';

// File picker + drop zone. Calls onFiles with each file's extracted text.
export function FileImport({
  onFiles,
  label = 'Add files',
  hint,
}: {
  onFiles: (files: { name: string; text: string }[]) => void;
  label?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');

  async function handle(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError('');
    const out: { name: string; text: string }[] = [];
    const failed: string[] = [];
    for (const f of Array.from(list)) {
      try {
        const text = await fileToText(f);
        if (text) out.push({ name: f.name.replace(/\.[^.]+$/, ''), text });
        else failed.push(`${f.name} (no text found — is it a scanned image?)`);
      } catch {
        failed.push(f.name);
      }
    }
    setBusy(false);
    if (failed.length) setError(`Couldn't read: ${failed.join(', ')}`);
    if (out.length) onFiles(out);
    if (input.current) input.current.value = '';
  }

  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
    >
      <input ref={input} type="file" multiple accept={ACCEPTED_FILES} hidden onChange={(e) => handle(e.target.files)} />
      <button type="button" className="btn small" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Reading…' : label}
      </button>
      <span className="muted">{hint ?? 'or drop Word, PDF, text or Markdown files here'}</span>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
