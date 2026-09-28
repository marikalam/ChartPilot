import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { screenRouter } from './routes/screen';
import { notesRouter } from './routes/notes';
import { evidenceRouter, externalEvidenceConfigured } from './routes/evidence';
import { MODEL } from './claude';

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const PASSCODE = process.env.APP_PASSCODE || '';

app.disable('x-powered-by');
// Rulebooks can run to hundreds of pages of text
app.use(express.json({ limit: '25mb' }));

// Patient text passes through but is never stored or logged by this server.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  res.json({
    model: MODEL,
    passcodeRequired: Boolean(PASSCODE),
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    externalEvidence: externalEvidenceConfigured(),
  });
});

// Shared passcode so a public URL doesn't hand out your API key's spend.
function safeEqual(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
app.use('/api', (req, res, next) => {
  if (!PASSCODE) return next();
  const given = req.header('x-app-passcode') ?? '';
  if (!safeEqual(given, PASSCODE)) {
    res.status(401).json({ error: 'Wrong or missing passcode' });
    return;
  }
  next();
});

app.post('/api/auth/check', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/screen', screenRouter);
app.use('/api/notes', notesRouter);
app.use('/api/evidence', evidenceRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// In production the built client is served from ./public
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number }).status ?? 500;
  if (status === 413) {
    res.status(413).json({ error: 'That upload is too large (limit 25 MB of text).' });
    return;
  }
  console.error('Unhandled error:', err instanceof Error ? err.message : err);
  res.status(status).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`ChartPilot listening on :${PORT} (model ${MODEL})`);
});
