import { Router } from 'express';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type Anthropic from '@anthropic-ai/sdk';
import {
  client,
  MODEL,
  FALLBACK,
  cachedBlock,
  openSse,
  describeError,
  refusalMessage,
  summarizeUsage,
} from '../claude';
import { SCREEN_SYSTEM, SCREEN_NO_RULEBOOK } from '../prompts';
import { DocSchema, renderDocuments } from '../documents';

const Citation = z.object({
  source: z.string().describe('Rulebook document name, or "General practice"'),
  section: z.string().describe('Section or heading within the document'),
  quote: z.string().describe('Short verbatim quote of the rule, or empty string'),
});

export const ScreeningResult = z.object({
  case_summary: z.string().describe('One-line summary of the presentation'),
  options: z
    .array(
      z.object({
        disposition: z
          .string()
          .describe('Destination, e.g. "ED Observation – chest pain pathway", "Admit – telemetry", "Discharge home"'),
        confidence: z.number().describe('0-100'),
        rationale: z.string(),
        criteria_met: z.array(z.string()),
        concerns: z.array(z.string()).describe('Criteria not met, borderline items or risks for this option'),
        citations: z.array(Citation),
      }),
    )
    .describe('Ranked best first'),
  decision_path: z
    .array(
      z.object({
        step: z.string().describe('The question asked at this node, e.g. "Any hard exclusion?"'),
        finding: z.string().describe('What the case shows'),
        outcome: z.string().describe('Where this sends the decision'),
        citation: Citation.nullable(),
      }),
    )
    .describe('The decision tree walked for this patient, in order'),
  exclusions_triggered: z.array(
    z.object({ rule: z.string(), explanation: z.string(), citation: Citation }),
  ),
  missing_information: z.array(
    z.object({
      item: z.string(),
      impact: z.string().describe('How the answer would change the disposition'),
    }),
  ),
  red_flags: z.array(z.string()),
  rulebook_conflicts: z.array(z.string()).describe('Places where rulebook documents disagree on this case'),
  caveats: z.string(),
});

const Body = z.object({
  rulebook: z.array(DocSchema).max(200).default([]),
  patient: z.string().min(1, 'Paste the patient presentation first'),
  context: z.string().optional().default(''),
});

export const screenRouter = Router();

screenRouter.post('/', async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const { rulebook, patient, context } = parsed.data;
  const hasRulebook = rulebook.some((d) => d.text.trim());

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SCREEN_SYSTEM },
    hasRulebook
      ? cachedBlock(renderDocuments('rulebook', rulebook))
      : { type: 'text', text: SCREEN_NO_RULEBOOK },
  ];

  let userText = `<patient_presentation>\n${patient.trim()}\n</patient_presentation>`;
  if (context.trim()) {
    userText += `\n\n<unit_context>\n${context.trim()}\n</unit_context>`;
  }

  const sse = openSse(res);
  try {
    sse.send('status', { phase: 'thinking' });
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(ScreeningResult) },
      system,
      messages: [{ role: 'user', content: userText }],
    });
    let writing = false;
    stream.on('text', () => {
      if (writing) return;
      writing = true;
      sse.send('status', { phase: 'writing' });
    });
    res.on('close', () => stream.abort());

    const msg = await stream.finalMessage();
    const refused = refusalMessage(msg);
    if (refused) {
      sse.send('error', { message: refused });
    } else if (!msg.parsed_output) {
      sse.send('error', {
        message:
          msg.stop_reason === 'max_tokens'
            ? 'The answer was cut off (too long). Try again.'
            : 'Could not read the model’s answer. Try again.',
      });
    } else {
      sse.send('result', { result: msg.parsed_output, usage: summarizeUsage(msg.usage), model: msg.model });
    }
  } catch (err) {
    if (!res.writableEnded) sse.send('error', { message: describeError(err) });
  } finally {
    sse.end();
  }
});
