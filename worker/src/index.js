// ChartPilot proxy: keeps the Anthropic API key off the browser.
//
// The app (static, on GitHub Pages) builds its own Claude requests; this
// Worker checks the passcode, adds the key and streams bytes straight through
// in both directions. It never parses the request body - rulebooks can be
// several MB, and passing bytes through costs almost no CPU, so it fits the
// free Workers plan. Nothing is logged or stored.

/**
 * @typedef {object} Env
 * @property {string} ANTHROPIC_API_KEY
 * @property {string} [APP_PASSCODE]
 * @property {string} [ALLOWED_ORIGINS]
 * @property {string} [CLAUDE_MODEL]
 * @property {string} [EVIDENCE_API_URL]
 * @property {string} [EVIDENCE_API_KEY]
 * @property {string} [ANTHROPIC_API_BASE] Local testing only: point at a mock instead of api.anthropic.com
 */

// Defaults, so the file also works pasted into the Cloudflare dashboard
// editor without a wrangler.toml
const DEFAULT_ORIGINS = 'https://marikalam.github.io,http://localhost:5173';
const DEFAULT_MODEL = 'claude-opus-5-5';

// Request headers forwarded to Anthropic (everything else is dropped)
const FORWARD_HEADERS = ['content-type', 'anthropic-version', 'anthropic-beta', 'accept'];

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim());
    const cors = corsHeaders(allowed.includes(origin) ? origin : '', request);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (origin && !allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403, cors);

    const url = new URL(request.url);

    if (url.pathname === '/config' && request.method === 'GET') {
      return json(
        {
          model: env.CLAUDE_MODEL || DEFAULT_MODEL,
          passcodeRequired: Boolean(env.APP_PASSCODE),
          apiKeyConfigured: Boolean(env.ANTHROPIC_API_KEY),
          externalEvidence: Boolean(env.EVIDENCE_API_URL),
        },
        200,
        cors,
      );
    }

    if (!(await passcodeOk(request, env))) return json({ error: 'Wrong or missing passcode' }, 401, cors);

    if (url.pathname === '/auth/check' && request.method === 'POST') return json({ ok: true }, 200, cors);

    // Claude Messages API (the only Anthropic endpoint the app uses)
    if (url.pathname === '/v1/messages' && request.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: { message: 'ANTHROPIC_API_KEY is not set on the Worker' } }, 500, cors);
      const headers = new Headers({ 'x-api-key': env.ANTHROPIC_API_KEY });
      for (const h of FORWARD_HEADERS) {
        const v = request.headers.get(h);
        if (v) headers.set(h, v);
      }
      const upstream = await fetch(`${env.ANTHROPIC_API_BASE || 'https://api.anthropic.com'}/v1/messages${url.search}`, {
        method: 'POST',
        headers,
        body: request.body,
      });
      const out = new Headers(cors);
      for (const h of ['content-type', 'request-id', 'retry-after']) {
        const v = upstream.headers.get(h);
        if (v) out.set(h, v);
      }
      out.set('cache-control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }

    // Optional third-party evidence engine; see DEPLOY.md
    if (url.pathname === '/evidence' && request.method === 'POST') {
      if (!env.EVIDENCE_API_URL) return json({ error: 'No external evidence provider is configured' }, 404, cors);
      const upstream = await fetch(env.EVIDENCE_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(env.EVIDENCE_API_KEY ? { authorization: `Bearer ${env.EVIDENCE_API_KEY}` } : {}),
        },
        body: request.body,
      });
      const out = new Headers(cors);
      out.set('content-type', upstream.headers.get('content-type') ?? 'application/json');
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }

    return json({ error: 'Not found' }, 404, cors);
  },
};

/**
 * @param {string} origin
 * @param {Request} request
 * @returns {Record<string, string>}
 */
function corsHeaders(origin, request) {
  if (!origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    // The Anthropic SDK sends several x-stainless-* headers; allow what was asked for
    'access-control-allow-headers':
      request.headers.get('access-control-request-headers') ?? 'content-type, x-app-passcode',
    'access-control-expose-headers': 'request-id, retry-after',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/**
 * @param {Request} request
 * @param {Env} env
 */
async function passcodeOk(request, env) {
  if (!env.APP_PASSCODE) return true;
  const given = request.headers.get('x-app-passcode') ?? '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(env.APP_PASSCODE)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * @param {unknown} data
 * @param {number} status
 * @param {Record<string, string>} headers
 */
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
