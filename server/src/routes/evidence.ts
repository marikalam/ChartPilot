import { Router } from 'express';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { EVIDENCE_SYSTEM, EVIDENCE_WEB_ADDENDUM } from '../prompts';
import { streamText } from '../stream';
import { openSse, describeError } from '../claude';

// Guideline bodies and peer-reviewed literature only.
const EVIDENCE_DOMAINS = [
  'ncbi.nlm.nih.gov',
  'nih.gov',
  'cdc.gov',
  'who.int',
  'fda.gov',
  'dailymed.nlm.nih.gov',
  'uspreventiveservicestaskforce.org',
  'cochranelibrary.com',
  'nejm.org',
  'jamanetwork.com',
  'thelancet.com',
  'bmj.com',
  'annals.org',
  'acpjournals.org',
  'ahajournals.org',
  'heart.org',
  'acc.org',
  'escardio.org',
  'idsociety.org',
  'thoracic.org',
  'chestnet.org',
  'journal.chestnet.org',
  'diabetesjournals.org',
  'kdigo.org',
  'gastro.org',
  'gastrojournal.org',
  'hematology.org',
  'ashpublications.org',
  'acep.org',
  'annemergmed.com',
  'aafp.org',
  'hospitalmedicine.org',
  'journalofhospitalmedicine.com',
  'sccm.org',
  'survivingsepsis.org',
  'nice.org.uk',
  'aasld.org',
  'endocrine.org',
  'stroke.org',
  'ashp.org',
];

const Body = z.object({
  caseText: z.string().min(1, 'There is no case or draft note to review'),
  question: z.string().default(''),
  provider: z.enum(['claude', 'external']).default('claude'),
  webSearch: z.boolean().default(true),
});

export const evidenceRouter = Router();

export function externalEvidenceConfigured() {
  return Boolean(process.env.EVIDENCE_API_URL);
}

evidenceRouter.post('/', async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const { caseText, question, provider, webSearch } = parsed.data;

  if (provider === 'external') {
    await callExternal(res, caseText, question);
    return;
  }

  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: EVIDENCE_SYSTEM }];
  if (webSearch) system.push({ type: 'text', text: EVIDENCE_WEB_ADDENDUM });

  let userText = `<case>\n${caseText.trim()}\n</case>`;
  if (question.trim()) userText += `\n\nSpecific question from the physician: ${question.trim()}`;

  await streamText(res, {
    system,
    userText,
    effort: 'high',
    tools: webSearch
      ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6, allowed_domains: EVIDENCE_DOMAINS }]
      : undefined,
  });
});

// Adapter for a third-party evidence engine (e.g. OpenEvidence, if your
// institution has API access). Expects POST {question, context} -> JSON
// {answer: string, sources?: [{url, title}]}. Adjust here to match the
// provider's real contract once you have their API docs.
async function callExternal(res: import('express').Response, caseText: string, question: string) {
  const sse = openSse(res);
  try {
    const url = process.env.EVIDENCE_API_URL;
    if (!url) throw new Error('No external evidence provider is configured on the server (EVIDENCE_API_URL).');
    sse.send('status', { phase: 'searching' });
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.EVIDENCE_API_KEY ? { Authorization: `Bearer ${process.env.EVIDENCE_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        question:
          question.trim() ||
          'Give an evidence-based differential diagnosis, workup and management review for this case, citing guidelines.',
        context: caseText,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`Evidence provider returned ${r.status}`);
    const data = (await r.json()) as { answer?: string; sources?: { url: string; title: string }[] };
    sse.send('text', { delta: data.answer ?? '(The provider returned no answer.)' });
    sse.send('done', { sources: data.sources ?? [], usage: null, model: 'external' });
  } catch (err) {
    sse.send('error', { message: describeError(err) });
  } finally {
    sse.end();
  }
}
