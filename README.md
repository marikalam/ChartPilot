# ChartPilot

AI support for the hospitalist and observation-unit workflow, built on Claude. It does two jobs that were being done by pasting text into chats by hand:

1. **Observation screening.** Paste an ED presentation. ChartPilot applies your group's rulebook (the whole several-hundred-page manual, pathway documents, inclusion/exclusion lists) and returns **ranked disposition options with confidence levels**, the decision path it walked, the exact rules it relied on (document + section + quote), triggered exclusions, missing information that would change the answer, red flags, and places where rulebook documents contradict each other.
2. **Clinical write-up.** Dictate (in-browser speech-to-text) or paste the encounter, pick the hospital, and ChartPilot:
   - **drafts the note** in that hospital's template and your personal style, learning from example notes. It never invents findings; gaps show up as `[not documented]` and doubtful transcriptions as `[[verify: …]]`.
   - runs an **evidence review** (differential, guideline-based workup/management, safety checks). It can search PubMed, NIH, CDC, specialty societies and major journals and cite them. You can plug in an external evidence engine instead (see below).
   - **merges the review into a final note** in your style. Anything it adds is marked `[[added: …]]` for you to accept, and it lists what changed.

   "Run full workflow" does all three steps in one click, so you no longer copy and paste between tools.

## How it's put together

Live at **[marikalam.github.io/apps/chartpilot](https://marikalam.github.io/apps/chartpilot/)**, alongside [the other apps](https://marikalam.github.io/#projects).

| | |
|---|---|
| App | React + Vite (`client/`), a static site on GitHub Pages. It builds the Claude requests in the browser with the Anthropic SDK. |
| Proxy | A Cloudflare Worker (`worker/`) that checks the passcode, adds the Anthropic API key and streams bytes through. The key never reaches the browser. |
| AI | Claude Opus 5.5: adaptive thinking, structured outputs for screening, streaming for notes, server-side web search for evidence |

This is the same setup as KachunQuizer.ai. The Worker never parses request bodies, so even a several-megabyte rulebook costs it almost no CPU, and it fits Cloudflare's free plan.

Design choices that came out of the original workflow discussion:

- **Token efficiency.** The rulebook is sent as a cached prompt prefix (1-hour cache), so the first screening of a shift pays to cache the full manual and later ones read it at a small fraction of the price. Each request shows its token usage and approximate cost. For write-ups, only the selected hospital's profile is sent, not every hospital's files.
- **The rulebook is a tree of overlapping documents.** Upload any number of files (Word, PDF, text, Markdown) and put them in priority order. When documents conflict, the higher one wins and the conflict is reported.
- **Group sharing.** Library → Settings & backup exports the rulebook and style profiles as one JSON file. The nocturnist group can pass around a single current version and import it.
- **No patient data at rest.** The Worker stores and logs nothing. The browser keeps the library in IndexedDB. Patient text stays in memory and is gone on reload.
- **Access control.** A shared passcode (`APP_PASSCODE`, a Worker secret) keeps the public page from spending your API key. Only the listed site origins can call the Worker.

## Run locally

```bash
npm install && npm run install:all
cd worker && printf 'ANTHROPIC_API_KEY=sk-ant-...\n' > .dev.vars && cd ..   # local secret, git-ignored
npm run dev        # Worker on :8787, app on http://localhost:5173
```

## Deploy

See [DEPLOY.md](DEPLOY.md): a one-time Cloudflare Worker setup, then the app is a static build on GitHub Pages.

## Important

ChartPilot is decision support. The physician is responsible for every disposition and every signed note. Patient text is sent to the Anthropic API. Before using it with real PHI, confirm your institution's policy and that an appropriate agreement (for example a BAA with Anthropic) is in place. Otherwise use de-identified text.
