import type Anthropic from '@anthropic-ai/sdk';
import { EVIDENCE_SYSTEM, EVIDENCE_WEB_ADDENDUM } from './prompts';
import { streamText, type TextHandlers, type TextResult } from './claude';
import { PROXY_URL, currentPasscode } from '../api';

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

export async function evidenceReview(
  input: { caseText: string; question: string; provider: 'claude' | 'external'; webSearch: boolean },
  h: TextHandlers,
  signal?: AbortSignal,
): Promise<TextResult> {
  if (input.provider === 'external') return externalReview(input.caseText, input.question, h, signal);

  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: EVIDENCE_SYSTEM }];
  if (input.webSearch) system.push({ type: 'text', text: EVIDENCE_WEB_ADDENDUM });

  let userText = `<case>\n${input.caseText.trim()}\n</case>`;
  if (input.question.trim()) userText += `\n\nSpecific question from the physician: ${input.question.trim()}`;

  return streamText(
    {
      system,
      userText,
      effort: 'high',
      tools: input.webSearch
        ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6, allowed_domains: EVIDENCE_DOMAINS }]
        : undefined,
    },
    h,
    signal,
  );
}

// Third-party evidence engine (e.g. OpenEvidence) behind the Worker's
// /evidence route. Contract: POST {question, context} -> {answer, sources?}.
async function externalReview(caseText: string, question: string, h: TextHandlers, signal?: AbortSignal): Promise<TextResult> {
  h.onStatus?.('searching');
  const r = await fetch(`${PROXY_URL}/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-passcode': currentPasscode() },
    body: JSON.stringify({
      question:
        question.trim() ||
        'Give an evidence-based differential diagnosis, workup and management review for this case, citing guidelines.',
      context: caseText,
    }),
    signal,
  });
  if (!r.ok) throw new Error(`Evidence provider returned ${r.status}`);
  const data = (await r.json()) as { answer?: string; sources?: { url: string; title: string }[] };
  h.onText?.(data.answer ?? '(The provider returned no answer.)');
  return {
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    model: 'external',
    truncated: false,
    sources: data.sources ?? [],
  };
}
