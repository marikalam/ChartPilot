import { useRef, useState } from 'react';
import type { Library, Usage, Settings } from '../lib/types';
import { NOTE_TYPES } from '../lib/types';
import { draftNote, finalizeNote } from '../lib/ai/notes';
import { evidenceReview } from '../lib/ai/evidence';
import { describeError, type TextResult } from '../lib/ai/claude';
import { DictationButton, appendText } from '../components/Dictation';
import { CopyButton, ErrorBox, FlagSummary, Markdown, Sources, UsageLine, Working } from '../components/common';

type StepOutput = { usage: Usage | null; model: string };

export type WriteUpState = {
  siteId: string | null;
  noteType: string | null;
  dictation: string;
  data: string;
  question: string;
  draft: string;
  evidence: string;
  sources: { url: string; title: string }[];
  final: string;
  changes: string;
  meta: Partial<Record<Step, StepOutput>>;
};

type Step = 'draft' | 'evidence' | 'final';

export const emptyWriteUp: WriteUpState = {
  siteId: null,
  noteType: null,
  dictation: '',
  data: '',
  question: '',
  draft: '',
  evidence: '',
  sources: [],
  final: '',
  changes: '',
  meta: {},
};

const CHANGES_MARKER = '=== CHANGES ===';

export function WriteUpPage({
  library,
  settings,
  externalEvidence,
  state,
  setState,
  goLibrary,
}: {
  library: Library;
  settings: Settings;
  externalEvidence: boolean;
  state: WriteUpState;
  setState: (fn: (s: WriteUpState) => WriteUpState) => void;
  goLibrary: () => void;
}) {
  const [running, setRunning] = useState<Step | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const siteId = state.siteId ?? settings.defaultSiteId ?? library.sites[0]?.id ?? null;
  const site = library.sites.find((s) => s.id === siteId) ?? null;
  const noteType = state.noteType ?? settings.defaultNoteType;
  const provider = settings.evidenceProvider === 'external' && externalEvidence ? 'external' : 'claude';

  const patch = (p: Partial<WriteUpState>) => setState((s) => ({ ...s, ...p }));

  async function runStep(step: Step, input: { draft?: string; evidence?: string } = {}): Promise<string> {
    let out = '';
    const signal = abort.current!.signal;
    const reset: Partial<WriteUpState> =
      step === 'draft'
        ? { draft: '', evidence: '', sources: [], final: '', changes: '' }
        : step === 'evidence'
          ? { evidence: '', sources: [], final: '', changes: '' }
          : { final: '', changes: '' };
    patch(reset);
    setRunning(step);
    setPhase('thinking');

    const onText = (delta: string) => {
      out += delta;
      if (step === 'final') {
        const [note, changes = ''] = out.split(CHANGES_MARKER);
        patch({ final: note.trimEnd(), changes: changes.trim() });
      } else {
        patch({ [step]: out } as Partial<WriteUpState>);
      }
    };
    const onDone = (d: TextResult) => {
      setState((s) => ({
        ...s,
        meta: { ...s.meta, [step]: { usage: d.model === 'external' ? null : d.usage, model: d.model } },
        ...(step === 'evidence' ? { sources: d.sources } : {}),
      }));
      if (d.truncated) setError('The output hit the length limit and was cut off.');
    };
    const handlers = { onStatus: setPhase, onText };

    if (step === 'draft') {
      onDone(
        await draftNote(
          {
            personalStyle: library.personalStyle,
            site: site
              ? {
                  name: site.name,
                  styleGuide: site.styleGuide,
                  template: site.template,
                  examples: site.examples.map((e) => ({ name: e.name, text: e.text })),
                }
              : { name: 'General', styleGuide: '', template: '', examples: [] },
            noteType,
            dictation: state.dictation,
            data: state.data,
          },
          handlers,
          signal,
        ),
      );
    } else if (step === 'evidence') {
      onDone(
        await evidenceReview(
          { caseText: input.draft ?? state.draft, question: state.question, provider, webSearch: settings.webSearch },
          handlers,
          signal,
        ),
      );
    } else {
      onDone(await finalizeNote({ draft: input.draft ?? state.draft, evidence: input.evidence ?? state.evidence }, handlers, signal));
    }
    return out;
  }

  async function run(steps: Step[]) {
    setError(null);
    abort.current = new AbortController();
    try {
      let draft: string | undefined;
      let evidence: string | undefined;
      for (const step of steps) {
        const out = await runStep(step, { draft, evidence });
        if (step === 'draft') draft = out;
        if (step === 'evidence') evidence = out;
      }
    } catch (e) {
      if (!abort.current?.signal.aborted) setError(describeError(e));
    } finally {
      setRunning(null);
      setPhase(null);
    }
  }

  const busy = running !== null;
  const canDraft = !!state.dictation.trim() && !busy;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Clinical write-up</h1>
          <p className="muted">Dictate the encounter, draft the note in your hospital's style, check it against the evidence, and merge the two.</p>
        </div>
      </header>

      <section className="card">
        <div className="row">
          <label className="grow">
            Hospital / style
            {library.sites.length ? (
              <select value={siteId ?? ''} onChange={(e) => patch({ siteId: e.target.value })}>
                {library.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <button type="button" className="btn ghost block" onClick={goLibrary}>
                Add a hospital style profile
              </button>
            )}
          </label>
          <label className="grow">
            Note type
            <select value={noteType} onChange={(e) => patch({ noteType: e.target.value })}>
              {[...new Set([...NOTE_TYPES, noteType])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-head">
          <label htmlFor="dictation">Dictation / encounter</label>
          <DictationButton onText={(t) => setState((s) => ({ ...s, dictation: appendText(s.dictation, t) }))} />
        </div>
        <textarea
          id="dictation"
          rows={10}
          placeholder="Dictate here, or paste a transcript of your conversation with the patient…"
          value={state.dictation}
          onChange={(e) => patch({ dictation: e.target.value })}
        />
        <details className="more">
          <summary>Supporting data (optional)</summary>
          <textarea
            rows={5}
            placeholder="Vitals, labs, imaging reads, med list, prior notes…"
            value={state.data}
            onChange={(e) => patch({ data: e.target.value })}
          />
        </details>
        <div className="actions">
          <button className="btn primary" disabled={!canDraft} onClick={() => run(['draft', 'evidence', 'final'])}>
            Run full workflow
          </button>
          <button className="btn" disabled={!canDraft} onClick={() => run(['draft'])}>
            Draft note only
          </button>
          {busy && (
            <button className="btn ghost" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          )}
          {!busy && (state.dictation || state.draft) && (
            <button className="btn ghost" onClick={() => setState(() => ({ ...emptyWriteUp, siteId: state.siteId }))}>
              New patient
            </button>
          )}
        </div>
        <ErrorBox message={error} />
      </section>

      <Stepper state={state} running={running} />

      {(state.draft || running === 'draft') && (
        <section className="card">
          <div className="section-head">
            <h2>1 · Draft note</h2>
            {running === 'draft' ? <Working phase={phase} /> : <CopyButton text={state.draft} />}
          </div>
          <FlagSummary text={state.draft} />
          <textarea
            className="note"
            rows={18}
            value={state.draft}
            readOnly={running === 'draft'}
            onChange={(e) => patch({ draft: e.target.value })}
          />
          <UsageLine usage={state.meta.draft?.usage ?? null} model={state.meta.draft?.model ?? ''} />
          {!busy && state.draft && (
            <div className="evidence-controls">
              <input
                placeholder="Specific question for the evidence review (optional)"
                value={state.question}
                onChange={(e) => patch({ question: e.target.value })}
              />
              <button className="btn" onClick={() => run(['evidence', 'final'])}>
                {state.evidence ? 'Re-run evidence review' : 'Evidence review →'}
              </button>
            </div>
          )}
        </section>
      )}

      {(state.evidence || running === 'evidence') && (
        <section className="card">
          <div className="section-head">
            <h2>2 · Evidence review {provider === 'external' && <span className="chip muted">external provider</span>}</h2>
            {running === 'evidence' ? <Working phase={phase} /> : <CopyButton text={state.evidence} />}
          </div>
          <Markdown text={state.evidence} />
          <Sources sources={state.sources} />
          <UsageLine usage={state.meta.evidence?.usage ?? null} model={state.meta.evidence?.model ?? ''} />
          {!busy && state.evidence && (
            <div className="actions">
              <button className="btn" onClick={() => run(['final'])}>
                {state.final ? 'Re-merge into final note' : 'Merge into final note →'}
              </button>
            </div>
          )}
        </section>
      )}

      {(state.final || running === 'final') && (
        <section className="card featured">
          <div className="section-head">
            <h2>3 · Final note</h2>
            {running === 'final' ? <Working phase={phase} /> : <CopyButton text={stripMarkers(state.final)} label="Copy for EHR" />}
          </div>
          <FlagSummary text={state.final} />
          <textarea
            className="note"
            rows={22}
            value={state.final}
            readOnly={running === 'final'}
            onChange={(e) => patch({ final: e.target.value })}
          />
          {state.changes && (
            <details className="more" open>
              <summary>What changed from the draft</summary>
              <Markdown text={state.changes} />
            </details>
          )}
          <p className="muted small">
            “Copy for EHR” removes the [[added: …]] wrappers but keeps the text; resolve every [[verify]] and [[consider]] item first.
          </p>
          <UsageLine usage={state.meta.final?.usage ?? null} model={state.meta.final?.model ?? ''} />
        </section>
      )}
    </div>
  );
}

function Stepper({ state, running }: { state: WriteUpState; running: Step | null }) {
  const steps: [Step, string, boolean][] = [
    ['draft', 'Draft', !!state.draft],
    ['evidence', 'Evidence', !!state.evidence],
    ['final', 'Final', !!state.final],
  ];
  if (!state.draft && !running) return null;
  return (
    <ol className="stepper">
      {steps.map(([k, label, done]) => (
        <li key={k} className={running === k ? 'active' : done ? 'done' : ''}>
          {label}
        </li>
      ))}
    </ol>
  );
}

// [[added: X]] -> X ; other markers are left for the physician to resolve.
function stripMarkers(text: string) {
  return text.replace(/\[\[added:\s*([\s\S]*?)\]\]/g, '$1');
}
