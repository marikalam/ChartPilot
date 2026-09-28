# Deploying ChartPilot

ChartPilot has two parts, set up the same way as KachunQuizer.ai:

- **The app:** static files served by GitHub Pages at `marikalam.github.io/apps/chartpilot/`, from the `chartpilot/` folder of the `apps` repo's `gh-pages` branch.
- **The proxy:** a Cloudflare Worker, `chartpilot-proxy`, that holds the Anthropic API key. The app expects it at `https://chartpilot-proxy.marikalam.workers.dev`.

Both are free. The app is already published; the Worker needs the one-time setup below.

## 1. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com), sign in, and add billing.
2. **API Keys → Create key.** Copy it (starts with `sk-ant-`). You'll paste it into Cloudflare, never into the app or the repo.

Cost guide at Claude Opus 5.5 list prices ($4 / $20 per million input/output tokens): a screening against a ~250k-token rulebook costs about $2 the first time in an hour (writing the cache) and roughly $0.10–0.25 after that while the cache is warm. A full write-up (draft, evidence review, final note) usually costs a few tens of cents. The app shows the estimate under every result.

## 2. Create the Worker

Pick either option.

### Option A: Cloudflare dashboard (no command line)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Create Worker** (start from "Hello World").
2. Name it **`chartpilot-proxy`** exactly, so the URL matches what the app expects, then **Deploy**.
3. **Edit code:** replace everything with the contents of [`worker/src/index.js`](worker/src/index.js), then **Deploy**.
4. Go to **Settings → Variables and Secrets** and add, as type **Secret**:
   - `ANTHROPIC_API_KEY`: the key from step 1
   - `APP_PASSCODE`: a passcode colleagues type once per device. Strongly recommended, because the page is public.

### Option B: command line

```bash
cd worker
npm install
npx wrangler login                          # opens the browser once
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when prompted
npx wrangler secret put APP_PASSCODE        # choose a passcode
```

### Check it

Open `https://chartpilot-proxy.marikalam.workers.dev/config`. It should show `"apiKeyConfigured":true`. Then open [the app](https://marikalam.github.io/apps/chartpilot/) and enter the passcode.

If your workers.dev subdomain isn't `marikalam`, the Worker URL will differ. In that case either rebuild the app with `VITE_PROXY_URL=<your worker URL>`, or ask Claude to update it.

## 3. First-time setup in the app

1. **Library → Screening rulebook:** upload the manual and pathway documents. Put the current consolidated version at the top.
2. **Library → Note styles:** write your personal style, then add one profile per hospital with its template, style rules and 2–5 de-identified example notes.
3. **Library → Settings & backup → Export library:** share this file with the group so everyone works from the same rulebook.

## Updating the app

```bash
cd client && npm run build      # builds for /apps/chartpilot/
```

Copy `client/dist/*` into the `chartpilot/` folder of the `apps` repo's `gh-pages` branch and push. Changes to the Worker are redeployed with `npx wrangler deploy`, or by pasting `worker/src/index.js` into the dashboard editor again.

## Connecting OpenEvidence (the open action item)

The evidence step can go to any evidence engine with an HTTP API instead of Claude. Add the Worker secrets `EVIDENCE_API_URL` (and `EVIDENCE_API_KEY` if needed), and **Library → Settings → External evidence engine** becomes selectable.

The Worker forwards `POST {question, context}` to that URL with `Authorization: Bearer $EVIDENCE_API_KEY`, and the app expects `{answer, sources?: [{url, title}]}` back (`client/src/lib/ai/evidence.ts`). OpenEvidence doesn't publish a self-serve public API that we could verify. Ask them (or your institution's OpenEvidence contact) about API or enterprise access. Once you have their API docs, adjusting the mapping takes a few lines. Until then, the built-in Claude review with guideline/literature search covers the same step without the copy and paste.
