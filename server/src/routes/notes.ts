import { Router } from 'express';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { cachedBlock } from '../claude';
import { NOTE_SYSTEM, FINALIZE_SYSTEM } from '../prompts';
import { DocSchema, renderDocuments } from '../documents';
import { streamText } from '../stream';

const DraftBody = z.object({
  personalStyle: z.string().default(''),
  site: z.object({
    name: z.string(),
    styleGuide: z.string().default(''),
    template: z.string().default(''),
    examples: z.array(DocSchema).default([]),
  }),
  noteType: z.string().default('H&P'),
  dictation: z.string().min(1, 'Add the dictation or encounter text first'),
  data: z.string().default(''),
});

const FinalizeBody = z.object({
  draft: z.string().min(1, 'There is no draft note to finalize'),
  evidence: z.string().min(1, 'Run the evidence review first'),
});

export const notesRouter = Router();

notesRouter.post('/draft', async (req, res) => {
  const parsed = DraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const { personalStyle, site, noteType, dictation, data } = parsed.data;

  // Only the selected hospital's profile is sent, never the whole library -
  // smaller prompts, and a separate cache entry per site.
  const profile = [
    `<hospital_profile name="${site.name.replace(/"/g, "'")}">`,
    site.styleGuide.trim() && `<style_rules>\n${site.styleGuide.trim()}\n</style_rules>`,
    site.template.trim() && `<template>\n${site.template.trim()}\n</template>`,
    site.examples.length ? renderDocuments('example_notes', site.examples) : '',
    '</hospital_profile>',
  ]
    .filter(Boolean)
    .join('\n\n');

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: NOTE_SYSTEM },
    {
      type: 'text',
      text: `<personal_style>\n${personalStyle.trim() || '(none provided)'}\n</personal_style>`,
    },
    cachedBlock(profile),
  ];

  let userText = `Note type: ${noteType}\n\n<dictation>\n${dictation.trim()}\n</dictation>`;
  if (data.trim()) userText += `\n\n<supporting_data>\n${data.trim()}\n</supporting_data>`;

  await streamText(res, { system, userText, effort: 'medium' });
});

notesRouter.post('/finalize', async (req, res) => {
  const parsed = FinalizeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  const { draft, evidence } = parsed.data;
  await streamText(res, {
    system: [{ type: 'text', text: FINALIZE_SYSTEM }],
    userText: `<draft_note>\n${draft.trim()}\n</draft_note>\n\n<evidence_review>\n${evidence.trim()}\n</evidence_review>`,
    effort: 'medium',
  });
});
