# Deploying ChartPilot

ChartPilot runs as a single Docker service (API plus built frontend) on **Render**. It has no database: the rulebook and style library live in each user's browser.

## 1. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in, and add billing.
2. **API Keys → Create key.** Copy it (starts with `sk-ant-`). You'll paste it into Render in the next step.

Cost guide at Claude Opus 5.5 list prices ($4 / $20 per million input/output tokens): a screening against a ~250k-token rulebook costs about $2 the first time in an hour (writing the cache) and roughly $0.10–0.25 after that while the cache is warm. A full write-up (draft, evidence review, final note) usually costs a few tens of cents. The app shows the estimate under every result.

## 2. Deploy on Render

1. Go to [render.com](https://render.com) and sign up with GitHub.
2. **New → Blueprint**, then select the `marikalam/ChartPilot` repository. Render reads `render.yaml`.
3. Fill in the secret environment variables:
   - `ANTHROPIC_API_KEY`: the key from step 1 (required)
   - `APP_PASSCODE`: a passcode colleagues type once per device (strongly recommended, because the URL is public)
   - `EVIDENCE_API_URL` / `EVIDENCE_API_KEY`: leave blank unless you have an external evidence engine (below)
4. **Deploy Blueprint.** When it's live, open the `https://chartpilot-….onrender.com` URL.

The free plan sleeps after inactivity, so the first request after a pause takes about 30–60 seconds to wake up. The Starter plan avoids that.

## 3. First-time setup in the app

1. **Library → Screening rulebook:** upload the manual and pathway documents. Put the current consolidated version at the top.
2. **Library → Note styles:** write your personal style, then add one profile per hospital with its template, style rules and 2–5 de-identified example notes.
3. **Library → Settings & backup → Export library:** share this file with the group so everyone works from the same rulebook.

## Connecting OpenEvidence (the open action item)

The evidence step goes through a small adapter (`server/src/routes/evidence.ts`, `callExternal`), so any evidence engine with an HTTP API can replace the built-in review with no UI changes. When `EVIDENCE_API_URL` is set, **Library → Settings → External evidence engine** becomes selectable.

The adapter currently sends `POST {question, context}` with `Authorization: Bearer $EVIDENCE_API_KEY` and expects `{answer, sources?: [{url, title}]}`. OpenEvidence doesn't publish a self-serve public API that we could verify. Ask them (or your institution's OpenEvidence contact) about API or enterprise access. Once you have their API docs, adjusting the request/response mapping in `callExternal` takes a few lines. Until then, the built-in Claude review with guideline/literature search covers the same step without the copy and paste.
