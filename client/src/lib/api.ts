import type { ServerConfig, Usage } from './types';

// The ChartPilot Worker (see worker/). Override for local dev with
// VITE_PROXY_URL=http://localhost:8787 in client/.env.local
export const PROXY_URL: string = (import.meta.env.VITE_PROXY_URL || 'https://chartpilot-proxy.marikalam.workers.dev').replace(/\/$/, '');

const PASSCODE_KEY = 'chartpilot.passcode';
let memoryPasscode = '';

export function currentPasscode(): string {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? memoryPasscode;
  } catch {
    return memoryPasscode;
  }
}

export function setPasscode(value: string) {
  memoryPasscode = value;
  try {
    localStorage.setItem(PASSCODE_KEY, value);
  } catch {
    /* private mode: passcode only lasts this page load */
  }
}

export async function getConfig(): Promise<ServerConfig> {
  const r = await fetch(`${PROXY_URL}/config`);
  if (!r.ok) throw new Error(`Server returned ${r.status}`);
  return r.json();
}

export async function checkPasscode(): Promise<boolean> {
  const r = await fetch(`${PROXY_URL}/auth/check`, { method: 'POST', headers: { 'x-app-passcode': currentPasscode() } });
  return r.ok;
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
