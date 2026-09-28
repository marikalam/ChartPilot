import type Anthropic from '@anthropic-ai/sdk';
import { cachedBlock, streamText, type TextHandlers, type TextResult } from './claude';
import { NOTE_SYSTEM, FINALIZE_SYSTEM } from './prompts';
import { renderDocuments, type NamedText } from './documents';

export type SiteProfile = { name: string; styleGuide: string; template: string; examples: NamedText[] };

export function draftNote(
  input: { personalStyle: string; site: SiteProfile; noteType: string; dictation: string; data: string },
  h: TextHandlers,
  signal?: AbortSignal,
): Promise<TextResult> {
  const { personalStyle, site, noteType, dictation, data } = input;

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
    { type: 'text', text: `<personal_style>\n${personalStyle.trim() || '(none provided)'}\n</personal_style>` },
    cachedBlock(profile),
  ];

  let userText = `Note type: ${noteType}\n\n<dictation>\n${dictation.trim()}\n</dictation>`;
  if (data.trim()) userText += `\n\n<supporting_data>\n${data.trim()}\n</supporting_data>`;

  return streamText({ system, userText, effort: 'medium' }, h, signal);
}

export function finalizeNote(input: { draft: string; evidence: string }, h: TextHandlers, signal?: AbortSignal) {
  return streamText(
    {
      system: [{ type: 'text', text: FINALIZE_SYSTEM }],
      userText: `<draft_note>\n${input.draft.trim()}\n</draft_note>\n\n<evidence_review>\n${input.evidence.trim()}\n</evidence_review>`,
      effort: 'medium',
    },
    h,
    signal,
  );
}
