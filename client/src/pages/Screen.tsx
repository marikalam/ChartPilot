import { useRef, useState } from 'react';
import type { Library, ScreeningResult, Usage, Citation } from '../lib/types';
import { streamPost, estimateTokens } from '../lib/api';
import { DictationButton, appendText } from '../components/Dictation';
import { CopyButton, ErrorBox, UsageLine, Working } from '../components/common';

export type ScreenState = {
  patient: string;
  context: string;
  result: ScreeningResult | null;
  usage: Usage | null;
  model: string;
};

export const emptyScreen: ScreenState = { patient: '', context: '', result: null, usage: null, model: '' };

export function ScreenPage({
  library,
  state,
  setState,
  goLibrary,
}: {
  library: Library;
  state: ScreenState;
  setState: (fn: (s: ScreenState) => ScreenState) => void;
  goLibrary: () => void;
}) {
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const docs = library.rulebook.filter((d) => d.text.trim());
  const tokens = docs.reduce((n, d) => n + estimateTokens(d.text), 0);

  async function run() {
    setError(null);
    setPhase('thinking');
    setState((s) => ({ ...s, result: null, usage: null }));
    abort.current = new AbortController();
    try {
      await streamPost(
        '/api/screen',
        {
          rulebook: docs.map((d) => ({ name: d.name, text: d.text })),
          patient: state.patient,
          context: state.context,
        },
        {
          onStatus: setPhase,
          onResult: (d) => setState((s) => ({ ...s, result: d.result, usage: d.usage, model: d.model })),
        },
        abort.current.signal,
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setPhase(null);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Observation screening</h1>
          <p className="muted">Paste the ED presentation. ChartPilot applies your unit's rulebook and ranks where the patient should go.</p>
        </div>
      </header>

      <div className={`rulebook-status ${docs.length ? '' : 'empty'}`}>
        {docs.length ? (
          <span>
            <strong>Rulebook:</strong> {docs.length} document{docs.length > 1 ? 's' : ''} · ~{tokens.toLocaleString()} tokens
            {tokens > 900_000 && <span className="error-text"> — too large for one request; trim or split it.</span>}
          </span>
        ) : (
          <span>No rulebook loaded — answers will use general observation-unit criteria only.</span>
        )}
        <button className="btn small ghost" onClick={goLibrary}>
          {docs.length ? 'Manage' : 'Add rulebook'}
        </button>
      </div>

      <section className="card">
        <div className="field-head">
          <label htmlFor="patient">Patient presentation</label>
          <DictationButton onText={(t) => setState((s) => ({ ...s, patient: appendText(s.patient, t) }))} />
        </div>
        <textarea
          id="patient"
          rows={10}
          placeholder="HPI, vitals, key labs/imaging, ED course, the consult question… (paste from the chart or ED note)"
          value={state.patient}
          onChange={(e) => setState((s) => ({ ...s, patient: e.target.value }))}
        />
        <details className="more">
          <summary>Unit context (optional)</summary>
          <textarea
            rows={3}
            placeholder="e.g. Obs unit at capacity tonight; no telemetry beds; cardiology not available until 8am"
            value={state.context}
            onChange={(e) => setState((s) => ({ ...s, context: e.target.value }))}
          />
        </details>
        <div className="actions">
          {phase ? (
            <>
              <Working phase={phase} />
              <button className="btn ghost" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={run} disabled={!state.patient.trim()}>
              Screen patient
            </button>
          )}
          {!phase && state.patient && (
            <button className="btn ghost" onClick={() => setState(() => emptyScreen)}>
              Clear
            </button>
          )}
        </div>
        <ErrorBox message={error} />
      </section>

      {state.result && <ScreeningView result={state.result} />}
      <UsageLine usage={state.usage} model={state.model} />
    </div>
  );
}

function Cite({ c }: { c: Citation }) {
  return (
    <span className="cite" title={c.quote || undefined}>
      {c.source}
      {c.section && <> · {c.section}</>}
    </span>
  );
}

function confidenceClass(n: number) {
  return n >= 70 ? 'high' : n >= 40 ? 'mid' : 'low';
}

function ScreeningView({ result }: { result: ScreeningResult }) {
  const [top, ...rest] = result.options;
  return (
    <div className="result">
      <div className="result-head">
        <p className="summary">{result.case_summary}</p>
        <CopyButton text={toPlainText(result)} label="Copy summary" />
      </div>

      {result.red_flags.length > 0 && (
        <div className="alert error">
          <strong>Red flags</strong>
          <ul>
            {result.red_flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {top && <OptionCard option={top} rank={1} featured />}
      {rest.map((o, i) => (
        <OptionCard key={i} option={o} rank={i + 2} />
      ))}

      {result.decision_path.length > 0 && (
        <section className="card">
          <h2>Decision path</h2>
          <ol className="tree">
            {result.decision_path.map((s, i) => (
              <li key={i}>
                <div className="tree-q">{s.step}</div>
                <div className="tree-a">{s.finding}</div>
                <div className="tree-o">→ {s.outcome}</div>
                {s.citation && <Cite c={s.citation} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid-2">
        {result.exclusions_triggered.length > 0 && (
          <section className="card">
            <h2>Exclusions triggered</h2>
            <ul className="plain">
              {result.exclusions_triggered.map((x, i) => (
                <li key={i}>
                  <strong>{x.rule}</strong> — {x.explanation} <Cite c={x.citation} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {result.missing_information.length > 0 && (
          <section className="card">
            <h2>Would change the answer</h2>
            <ul className="plain">
              {result.missing_information.map((m, i) => (
                <li key={i}>
                  <strong>{m.item}</strong> — {m.impact}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {result.rulebook_conflicts.length > 0 && (
        <div className="alert warn">
          <strong>Rulebook conflicts</strong>
          <ul>
            {result.rulebook_conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {result.caveats && <p className="muted small">{result.caveats}</p>}
    </div>
  );
}

function OptionCard({
  option: o,
  rank,
  featured,
}: {
  option: ScreeningResult['options'][number];
  rank: number;
  featured?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(o.confidence)));
  return (
    <section className={`card option ${featured ? 'featured' : ''}`}>
      <div className="option-head">
        <span className="rank">{rank}</span>
        <h2>{o.disposition}</h2>
        <span className={`confidence ${confidenceClass(pct)}`}>{pct}%</span>
      </div>
      <div className="bar">
        <span className={confidenceClass(pct)} style={{ width: `${pct}%` }} />
      </div>
      <p>{o.rationale}</p>
      <div className="grid-2 tight">
        {o.criteria_met.length > 0 && (
          <ul className="checks yes">
            {o.criteria_met.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
        {o.concerns.length > 0 && (
          <ul className="checks no">
            {o.concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </div>
      {o.citations.length > 0 && (
        <details className="citations" open={featured}>
          <summary>Rules applied ({o.citations.length})</summary>
          <ul>
            {o.citations.map((c, i) => (
              <li key={i}>
                <Cite c={c} />
                {c.quote && <blockquote>{c.quote}</blockquote>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function toPlainText(r: ScreeningResult) {
  const lines = [r.case_summary, ''];
  r.options.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.disposition} (${Math.round(o.confidence)}%) — ${o.rationale}`);
    for (const c of o.citations) lines.push(`   • ${c.source}${c.section ? `, ${c.section}` : ''}`);
  });
  if (r.red_flags.length) lines.push('', 'Red flags: ' + r.red_flags.join('; '));
  if (r.missing_information.length)
    lines.push('', 'Missing: ' + r.missing_information.map((m) => `${m.item} (${m.impact})`).join('; '));
  return lines.join('\n');
}
