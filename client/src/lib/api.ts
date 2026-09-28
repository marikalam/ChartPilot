import type { ServerConfig, Usage } from './types';

const PASSCODE_KEY = 'chartpilot.passcode';

export function getPasscode(): string {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPasscode(value: string) {
  try {
    localStorage.setItem(PASSCODE_KEY, value);
  } catch {
    /* private mode: passcode only lasts this page load */
  }
  memoryPasscode = value;
}

let memoryPasscode = '';

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-app-passcode': getPasscode() || memoryPasscode,
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function getConfig(): Promise<ServerConfig> {
  const r = await fetch('/api/config');
  if (!r.ok) throw new ApiError('Could not reach the server', r.status);
  return r.json();
}

export async function checkPasscode(): Promise<boolean> {
  const r = await fetch('/api/auth/check', { method: 'POST', headers: headers() });
  return r.ok;
}

export type StreamHandlers = {
  onStatus?: (phase: string) => void;
  onText?: (delta: string) => void;
  onResult?: (data: any) => void;
  onDone?: (data: { usage: Usage | null; model: string; truncated?: boolean; sources: { url: string; title: string }[] }) => void;
};

// POSTs JSON and reads the server-sent event stream the API answers with.
// Resolves when the stream ends; rejects with the server's error message.
export async function streamPost(path: string, body: unknown, h: StreamHandlers, signal?: AbortSignal) {
  const r = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) {
    let msg = `Request failed (${r.status})`;
    try {
      msg = (await r.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg, r.status);
  }

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let error: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === 'status') h.onStatus?.(payload.phase);
      else if (event === 'text') h.onText?.(payload.delta);
      else if (event === 'result') h.onResult?.(payload);
      else if (event === 'done') h.onDone?.(payload);
      else if (event === 'error') error = payload.message;
    }
  }
  if (error) throw new ApiError(error, 200);
}

// Rough cost at Claude Opus 5.5 list prices (per million tokens): input $4,
// output $20, 1h cache write $8, cache read $0.20.
export function estimateCost(u: Usage, model: string): number | null {
  if (!model.startsWith('claude-opus-5-5')) return null;
  return (u.input * 4 + u.output * 20 + u.cacheWrite * 8 + u.cacheRead * 0.2) / 1_000_000;
}

export function estimateTokens(text: string): number {
  return Math.round(text.length / 4);
}
