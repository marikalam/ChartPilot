import Anthropic from '@anthropic-ai/sdk';
import { PROXY_URL, currentPasscode } from '../api';
import type { Usage } from '../types';

// Requests go to the ChartPilot Worker, which adds the real API key. The
// placeholder key below is never sent to Anthropic.
export function claudeClient() {
  return new Anthropic({
    baseURL: PROXY_URL,
    apiKey: 'set-on-the-worker',
    dangerouslyAllowBrowser: true,
    defaultHeaders: { 'x-app-passcode': currentPasscode() },
    maxRetries: 2,
    timeout: 10 * 60 * 1000,
  });
}

export let MODEL = 'claude-opus-5-5';
export function setModel(m: string) {
  if (m) MODEL = m;
}

// Clinical text occasionally trips the model's safety classifiers (false
// positives on medication/biology wording). "default" lets the API re-run a
// declined request on a fallback model instead of just failing.
export const FALLBACK = {
  betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: 'default' as const,
};

// A reference document that stays identical across requests (a rulebook or a
// site style guide). The 1h cache means repeated screenings against a 300-page
// rulebook pay full price once, then a small fraction on every later request.
export function cachedBlock(text: string): Anthropic.Beta.BetaTextBlockParam {
  return { type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } };
}

export function summarizeUsage(u: Anthropic.Beta.BetaUsage): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The Worker’s Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY on the Worker (see DEPLOY.md).';
  }
  if (err instanceof Anthropic.PermissionDeniedError) return 'Access denied — check the passcode.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API — wait a moment and try again.';
  if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the ChartPilot server. Check your connection, or that the Worker is deployed.';
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return 'Wrong or missing passcode — reload the page and enter it again.';
    return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export function refusalMessage(msg: Anthropic.Beta.BetaMessage): string | null {
  if (msg.stop_reason !== 'refusal') return null;
  const why = msg.stop_details?.explanation;
  return `The model declined this request${why ? `: ${why}` : ''}. Try rephrasing or removing non-clinical content.`;
}

export type Source = { url: string; title: string };

export type TextHandlers = {
  onStatus?: (phase: string) => void;
  onText?: (delta: string) => void;
};

export type TextResult = { usage: Usage; model: string; truncated: boolean; sources: Source[] };

// Streams a text answer, reporting phases (thinking / searching / writing) and
// deltas. Resumes when a web-search turn pauses.
export async function streamText(
  p: {
    system: Anthropic.Beta.BetaTextBlockParam[];
    userText: string;
    effort: 'low' | 'medium' | 'high';
    tools?: Anthropic.Beta.BetaToolUnion[];
  },
  h: TextHandlers,
  signal?: AbortSignal,
): Promise<TextResult> {
  const client = claudeClient();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: p.userText }];
  const sources = new Map<string, Source>();

  for (let round = 0; round < 4; round++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        ...FALLBACK,
        thinking: { type: 'adaptive' },
        output_config: { effort: p.effort },
        system: p.system,
        messages,
        ...(p.tools ? { tools: p.tools } : {}),
      },
      { signal },
    );
    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_start') return;
      const block = event.content_block;
      if (block.type === 'server_tool_use' && block.name === 'web_search') h.onStatus?.('searching');
      else if (block.type === 'thinking') h.onStatus?.('thinking');
      else if (block.type === 'text') h.onStatus?.('writing');
    });
    stream.on('text', (delta) => h.onText?.(delta));

    const msg = await stream.finalMessage();
    for (const block of msg.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) sources.set(r.url, { url: r.url, title: r.title });
      }
    }
    const refused = refusalMessage(msg);
    if (refused) throw new Error(refused);
    if (msg.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      continue;
    }
    return {
      usage: summarizeUsage(msg.usage),
      model: msg.model,
      truncated: msg.stop_reason === 'max_tokens',
      sources: [...sources.values()],
    };
  }
  throw new Error('The answer took too many search rounds. Try again.');
}
