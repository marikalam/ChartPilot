import { useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Usage } from '../lib/types';
import { estimateCost } from '../lib/api';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn small ghost"
      disabled={!text}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

const PHASES: Record<string, string> = {
  thinking: 'Reasoning…',
  writing: 'Writing…',
  searching: 'Searching the literature…',
};

export function Working({ phase }: { phase: string | null }) {
  if (!phase) return null;
  return (
    <span className="working">
      <span className="spinner" aria-hidden /> {PHASES[phase] ?? 'Working…'}
    </span>
  );
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function UsageLine({ usage, model }: { usage: Usage | null; model: string }) {
  if (!usage) return null;
  const cost = estimateCost(usage, model);
  const total = usage.input + usage.cacheRead + usage.cacheWrite;
  return (
    <p className="usage">
      {total.toLocaleString()} tokens in
      {usage.cacheRead > 0 && <> ({usage.cacheRead.toLocaleString()} from cache)</>} ·{' '}
      {usage.output.toLocaleString()} out
      {cost !== null && <> · ≈ ${cost.toFixed(cost < 0.1 ? 3 : 2)}</>}
    </p>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="alert error">{message}</div>;
}

// Counts the review markers the prompts ask the model to leave in notes.
export function FlagSummary({ text }: { text: string }) {
  const verify = (text.match(/\[\[verify:/g) ?? []).length;
  const added = (text.match(/\[\[added:/g) ?? []).length;
  const consider = (text.match(/\[\[consider:/g) ?? []).length;
  const missing = (text.match(/\[not documented\]/g) ?? []).length;
  if (!verify && !added && !consider && !missing) return null;
  return (
    <div className="flags">
      {verify > 0 && <span className="chip warn">{verify} to verify</span>}
      {added > 0 && <span className="chip info">{added} added by evidence review</span>}
      {consider > 0 && <span className="chip info">{consider} to consider</span>}
      {missing > 0 && <span className="chip muted">{missing} not documented</span>}
    </div>
  );
}

export function Sources({ sources }: { sources: { url: string; title: string }[] }) {
  if (!sources.length) return null;
  return (
    <details className="sources">
      <summary>{sources.length} sources consulted</summary>
      <ol>
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.title || s.url}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
