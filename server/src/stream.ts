import type { Response } from 'express';
import type Anthropic from '@anthropic-ai/sdk';
import { client, MODEL, FALLBACK, openSse, describeError, refusalMessage, summarizeUsage } from './claude';

type StreamParams = {
  system: Anthropic.Beta.BetaTextBlockParam[];
  userText: string;
  effort: 'low' | 'medium' | 'high';
  tools?: Anthropic.Beta.BetaToolUnion[];
};

type Source = { url: string; title: string };

// Streams a text answer to the browser as SSE: `text` deltas, then `done` with
// usage and any web sources consulted, or `error`.
export async function streamText(res: Response, p: StreamParams) {
  const sse = openSse(res);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: p.userText }];
  const sources = new Map<string, Source>();
  let aborted = false;
  res.on('close', () => (aborted = true));

  try {
    // Server tools (web search) can pause a long turn; resume a few times.
    for (let round = 0; round < 4 && !aborted; round++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        ...FALLBACK,
        thinking: { type: 'adaptive' },
        output_config: { effort: p.effort },
        system: p.system,
        messages,
        ...(p.tools ? { tools: p.tools } : {}),
      });
      res.on('close', () => stream.abort());

      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'server_tool_use' && block.name === 'web_search') {
            sse.send('status', { phase: 'searching' });
          } else if (block.type === 'thinking') {
            sse.send('status', { phase: 'thinking' });
          } else if (block.type === 'text') {
            sse.send('status', { phase: 'writing' });
          }
        }
      });
      stream.on('text', (delta) => sse.send('text', { delta }));

      const msg = await stream.finalMessage();
      for (const block of msg.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) sources.set(r.url, { url: r.url, title: r.title });
        }
      }

      const refused = refusalMessage(msg);
      if (refused) {
        sse.send('error', { message: refused });
        return;
      }
      if (msg.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
        continue;
      }
      sse.send('done', {
        usage: summarizeUsage(msg.usage),
        model: msg.model,
        truncated: msg.stop_reason === 'max_tokens',
        sources: [...sources.values()],
      });
      return;
    }
  } catch (err) {
    if (!res.writableEnded) sse.send('error', { message: describeError(err) });
  } finally {
    sse.end();
  }
}
