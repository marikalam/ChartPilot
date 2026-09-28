import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type Anthropic from '@anthropic-ai/sdk';
import { claudeClient, MODEL, FALLBACK, cachedBlock, refusalMessage, summarizeUsage } from './claude';
import { SCREEN_SYSTEM, SCREEN_NO_RULEBOOK } from './prompts';
import { renderDocuments, type NamedText } from './documents';
import type { ScreeningResult as ScreeningResultType, Usage } from '../types';

const Citation = z.object({
  source: z.string().describe('Rulebook document name, or "General practice"'),
  section: z.string().describe('Section or heading within the document'),
  quote: z.string().describe('Short verbatim quote of the rule, or empty string'),
});

const ScreeningResult = z.object({
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
  exclusions_triggered: z.array(z.object({ rule: z.string(), explanation: z.string(), citation: Citation })),
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

export async function runScreening(
  input: { rulebook: NamedText[]; patient: string; context: string },
  onStatus: (phase: string) => void,
  signal?: AbortSignal,
): Promise<{ result: ScreeningResultType; usage: Usage; model: string }> {
  const hasRulebook = input.rulebook.some((d) => d.text.trim());
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: SCREEN_SYSTEM },
    hasRulebook ? cachedBlock(renderDocuments('rulebook', input.rulebook)) : { type: 'text', text: SCREEN_NO_RULEBOOK },
  ];

  let userText = `<patient_presentation>\n${input.patient.trim()}\n</patient_presentation>`;
  if (input.context.trim()) userText += `\n\n<unit_context>\n${input.context.trim()}\n</unit_context>`;

  const stream = claudeClient().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(ScreeningResult) },
      system,
      messages: [{ role: 'user', content: userText }],
    },
    { signal },
  );
  let writing = false;
  stream.on('text', () => {
    if (writing) return;
    writing = true;
    onStatus('writing');
  });

  const msg = await stream.finalMessage();
  const refused = refusalMessage(msg);
  if (refused) throw new Error(refused);
  if (!msg.parsed_output) {
    throw new Error(
      msg.stop_reason === 'max_tokens' ? 'The answer was cut off (too long). Try again.' : 'Could not read the model’s answer. Try again.',
    );
  }
  return { result: msg.parsed_output, usage: summarizeUsage(msg.usage), model: msg.model };
}
