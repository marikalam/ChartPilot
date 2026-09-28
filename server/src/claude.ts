import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';

export const client = new Anthropic();

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

// Clinical text occasionally trips the model's safety classifiers (false
// positives on medication/biology wording). "default" lets the API re-run a
// declined request on a fallback model instead of just failing.
export const FALLBACK = {
  betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: 'default' as const,
};

// A reference document that stays identical across requests (a rulebook or a
// site style guide). The 1h cache means repeated screenings against a 300-page
// rulebook pay full input price once, then ~10% on every later request.
export function cachedBlock(text: string): Anthropic.Beta.BetaTextBlockParam {
  return { type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } };
}

export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export function summarizeUsage(u: Anthropic.Beta.BetaUsage): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
}

// ---- Server-sent events ----

export function openSse(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  // Keep proxies (Render) from closing an idle connection while the model thinks
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => clearInterval(ping));
  return {
    send(event: string, data: unknown) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      clearInterval(ping);
      res.end();
    },
  };
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The server’s Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY on the server.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the Anthropic API — wait a moment and try again.';
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `The request was rejected: ${err.message}`;
  }
  if (err instanceof Anthropic.APIError) {
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
