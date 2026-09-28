import { useRef, useState } from 'react';
import type { Doc, Library, Site } from '../lib/types';
import { NOTE_TYPES } from '../lib/types';
import { estimateTokens, setPasscode } from '../lib/api';
import { newDoc, newSite, normalize } from '../lib/store';
import { FileImport } from '../components/FileImport';

type Tab = 'rulebook' | 'styles' | 'settings';

export function LibraryPage({
  library,
  update,
  externalEvidence,
  passcodeRequired,
}: {
  library: Library;
  update: (fn: (l: Library) => Library) => void;
  externalEvidence: boolean;
  passcodeRequired: boolean;
}) {
  const [tab, setTab] = useState<Tab>('rulebook');
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Library</h1>
          <p className="muted">
            Reference material ChartPilot works from. Stored only in this browser — use Backup to move it to another device or share it with your group.
          </p>
        </div>
      </header>
      <nav className="subtabs">
        <button className={tab === 'rulebook' ? 'on' : ''} onClick={() => setTab('rulebook')}>
          Screening rulebook
        </button>
        <button className={tab === 'styles' ? 'on' : ''} onClick={() => setTab('styles')}>
          Note styles
        </button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
          Settings & backup
        </button>
      </nav>
      {tab === 'rulebook' && <RulebookTab library={library} update={update} />}
      {tab === 'styles' && <StylesTab library={library} update={update} />}
      {tab === 'settings' && (
        <SettingsTab library={library} update={update} externalEvidence={externalEvidence} passcodeRequired={passcodeRequired} />
      )}
    </div>
  );
}

// ---------- Rulebook ----------

function RulebookTab({ library, update }: { library: Library; update: (fn: (l: Library) => Library) => void }) {
  const docs = library.rulebook;
  const total = docs.reduce((n, d) => n + estimateTokens(d.text), 0);
  const setDocs = (fn: (d: Doc[]) => Doc[]) => update((l) => ({ ...l, rulebook: fn(l.rulebook) }));

  return (
    <>
      <section className="card">
        <h2>Rulebook documents</h2>
        <p className="muted">
          Upload the group's manual, pathway documents (e.g. the UC Davis observation pathways), inclusion/exclusion lists and any updates. Order matters:
          when documents disagree, the one higher in the list wins — keep the newest consolidated version at the top.
        </p>
        <FileImport
          label="Upload documents"
          onFiles={(files) => setDocs((d) => [...files.map((f) => newDoc(f.name, f.text)), ...d])}
        />
        <PasteDoc onAdd={(name, text) => setDocs((d) => [newDoc(name, text), ...d])} />
        {docs.length > 0 && (
          <p className="muted small">
            {docs.length} documents · ~{total.toLocaleString()} tokens. The rulebook is cached for an hour after each use, so repeat screenings
            cost a small fraction of the first one.
          </p>
        )}
      </section>
      <DocList docs={docs} setDocs={setDocs} ordered />
    </>
  );
}

function PasteDoc({ onAdd, label = 'Paste text instead' }: { onAdd: (name: string, text: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  if (!open)
    return (
      <button className="btn small ghost" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <div className="paste">
      <input placeholder="Document name" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea rows={6} placeholder="Paste text…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="actions">
        <button
          className="btn small primary"
          disabled={!text.trim()}
          onClick={() => {
            onAdd(name.trim() || 'Pasted document', text);
            setName('');
            setText('');
            setOpen(false);
          }}
        >
          Add
        </button>
        <button className="btn small ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function DocList({ docs, setDocs, ordered }: { docs: Doc[]; setDocs: (fn: (d: Doc[]) => Doc[]) => void; ordered?: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!docs.length) return null;
  const move = (i: number, dir: -1 | 1) =>
    setDocs((d) => {
      const next = [...d];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const patchDoc = (id: string, p: Partial<Doc>) => setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <ul className="doclist">
      {docs.map((d, i) => (
        <li key={d.id} className="card">
          <div className="doc-row">
            {ordered && <span className="rank">{i + 1}</span>}
            <input className="doc-name" value={d.name} onChange={(e) => patchDoc(d.id, { name: e.target.value })} aria-label="Document name" />
            <span className="muted small nowrap">~{estimateTokens(d.text).toLocaleString()} tokens</span>
            {ordered && (
              <>
                <button className="icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon" title="Move down" disabled={i === docs.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </>
            )}
            <button className="icon" title="View / edit" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
              {openId === d.id ? '▾' : '▸'}
            </button>
            <button
              className="icon danger"
              title="Remove"
              onClick={() => confirm(`Remove “${d.name}”?`) && setDocs((all) => all.filter((x) => x.id !== d.id))}
            >
              ✕
            </button>
          </div>
          {openId === d.id && (
            <textarea className="doc-text" rows={16} value={d.text} onChange={(e) => patchDoc(d.id, { text: e.target.value })} />
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------- Note styles ----------

function StylesTab({ library, update }: { library: Library; update: (fn: (l: Library) => Library) => void }) {
  const [selected, setSelected] = useState<string | null>(library.sites[0]?.id ?? null);
  const site = library.sites.find((s) => s.id === selected) ?? null;
  const patchSite = (p: Partial<Site>) =>
    update((l) => ({ ...l, sites: l.sites.map((s) => (s.id === selected ? { ...s, ...p } : s)) }));

  return (
    <>
      <section className="card">
        <h2>Personal style</h2>
        <p className="muted">How you write, wherever you are: voice, favorite abbreviations, how you structure the assessment and plan, pet peeves.</p>
        <textarea
          rows={6}
          placeholder="e.g. Problem-based A&P, most acute problem first. Use '#' for problems. Terse HPI, no 'patient states'. Always end with Code status / Dispo / Contact."
          value={library.personalStyle}
          onChange={(e) => update((l) => ({ ...l, personalStyle: e.target.value }))}
        />
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Hospital profiles</h2>
          <button
            className="btn small"
            onClick={() => {
              const s = newSite();
              update((l) => ({ ...l, sites: [...l.sites, s] }));
              setSelected(s.id);
            }}
          >
            + Add hospital
          </button>
        </div>
        <p className="muted">One per hospital or service. Only the profile you pick is sent when drafting, which keeps each request small.</p>
        {library.sites.length > 0 && (
          <div className="pills">
            {library.sites.map((s) => (
              <button key={s.id} className={s.id === selected ? 'on' : ''} onClick={() => setSelected(s.id)}>
                {s.name || 'Untitled'}
              </button>
            ))}
          </div>
        )}
      </section>

      {site && (
        <section className="card">
          <label>
            Name
            <input value={site.name} onChange={(e) => patchSite({ name: e.target.value })} />
          </label>
          <label>
            Template
            <textarea
              rows={10}
              placeholder={'CHIEF COMPLAINT:\nHPI:\nPMH / PSH:\nMEDICATIONS:\nALLERGIES:\nSOCIAL / FAMILY HX:\nROS:\nEXAM:\nDATA:\nASSESSMENT & PLAN:\nFEN/PPx/Code/Dispo:'}
              value={site.template}
              onChange={(e) => patchSite({ template: e.target.value })}
            />
          </label>
          <label>
            Style rules for this hospital
            <textarea
              rows={5}
              placeholder="e.g. Epic smartphrases kept as-is (.VS, .LABS). Attending attestation line at the end. No abbreviations in A&P for this hospital."
              value={site.styleGuide}
              onChange={(e) => patchSite({ styleGuide: e.target.value })}
            />
          </label>
          <h3>Example notes</h3>
          <p className="muted small">2–5 de-identified notes you're happy with. The model copies their structure and voice.</p>
          <FileImport
            label="Upload examples"
            onFiles={(files) => patchSite({ examples: [...site.examples, ...files.map((f) => newDoc(f.name, f.text))] })}
          />
          <PasteDoc
            label="Paste an example"
            onAdd={(name, text) => patchSite({ examples: [...site.examples, newDoc(name, text)] })}
          />
          <DocList docs={site.examples} setDocs={(fn) => patchSite({ examples: fn(site.examples) })} />
          <div className="actions">
            <button
              className="btn small danger"
              onClick={() => {
                if (!confirm(`Delete the “${site.name}” profile?`)) return;
                update((l) => ({ ...l, sites: l.sites.filter((s) => s.id !== site.id) }));
                setSelected(library.sites.find((s) => s.id !== site.id)?.id ?? null);
              }}
            >
              Delete profile
            </button>
          </div>
        </section>
      )}
    </>
  );
}

// ---------- Settings ----------

function SettingsTab({
  library,
  update,
  externalEvidence,
  passcodeRequired,
}: {
  library: Library;
  update: (fn: (l: Library) => Library) => void;
  externalEvidence: boolean;
  passcodeRequired: boolean;
}) {
  const s = library.settings;
  const set = (p: Partial<typeof s>) => update((l) => ({ ...l, settings: { ...l.settings, ...p } }));
  const fileInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  function exportLibrary(includeSettings: boolean) {
    const data = includeSettings ? library : { ...library, settings: undefined };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chartpilot-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importLibrary(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = normalize(JSON.parse(await file.text()));
      const replace = confirm(
        'Replace your current library with this file?\n\nOK = replace everything\nCancel = merge (add its documents and hospitals to yours)',
      );
      update((l) =>
        replace
          ? { ...incoming, settings: l.settings }
          : {
              ...l,
              rulebook: [...incoming.rulebook, ...l.rulebook.filter((d) => !incoming.rulebook.some((x) => x.id === d.id))],
              sites: [...l.sites.filter((x) => !incoming.sites.some((y) => y.id === x.id)), ...incoming.sites],
              personalStyle: l.personalStyle || incoming.personalStyle,
            },
      );
      setMsg(`Imported ${incoming.rulebook.length} rulebook documents and ${incoming.sites.length} hospital profiles.`);
    } catch {
      setMsg('That file is not a ChartPilot library export.');
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <>
      <section className="card">
        <h2>Evidence review</h2>
        <label className="radio">
          <input type="radio" checked={s.evidenceProvider === 'claude'} onChange={() => set({ evidenceProvider: 'claude' })} />
          <span>
            <strong>Claude</strong> — clinical reasoning review of the draft
          </span>
        </label>
        <label className={`radio indent ${s.evidenceProvider !== 'claude' ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={s.webSearch}
            disabled={s.evidenceProvider !== 'claude'}
            onChange={(e) => set({ webSearch: e.target.checked })}
          />
          <span>
            Search guideline and journal sites (PubMed, NIH, CDC, specialty societies, major journals) and cite them. Only generic clinical terms are
            searched.
          </span>
        </label>
        <label className={`radio ${externalEvidence ? '' : 'disabled'}`}>
          <input
            type="radio"
            disabled={!externalEvidence}
            checked={s.evidenceProvider === 'external'}
            onChange={() => set({ evidenceProvider: 'external' })}
          />
          <span>
            <strong>External evidence engine</strong> (e.g. OpenEvidence) —{' '}
            {externalEvidence ? 'configured on the server' : 'not configured; see DEPLOY.md to connect one'}
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Defaults</h2>
        <label>
          Default note type
          <select value={s.defaultNoteType} onChange={(e) => set({ defaultNoteType: e.target.value })}>
            {NOTE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {library.sites.length > 0 && (
          <label>
            Default hospital
            <select value={s.defaultSiteId ?? ''} onChange={(e) => set({ defaultSiteId: e.target.value || null })}>
              <option value="">First in list</option>
              {library.sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="card">
        <h2>Backup & share</h2>
        <p className="muted">
          Export the rulebook and style profiles as one file — to move to another computer, or to hand the current rulebook to the rest of the group.
          Exports contain no patient data.
        </p>
        <div className="actions">
          <button className="btn small" onClick={() => exportLibrary(true)}>
            Export library
          </button>
          <button className="btn small" onClick={() => fileInput.current?.click()}>
            Import library
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => importLibrary(e.target.files?.[0])} />
        </div>
        {msg && <p className="muted small">{msg}</p>}
      </section>

      {passcodeRequired && (
        <section className="card">
          <h2>Access</h2>
          <button
            className="btn small ghost"
            onClick={() => {
              setPasscode('');
              location.reload();
            }}
          >
            Forget passcode on this device
          </button>
        </section>
      )}
    </>
  );
}
