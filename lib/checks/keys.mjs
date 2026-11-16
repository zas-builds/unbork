// Check 1: keys that should never be in a site's JavaScript.
//
// Some keys are meant to be public (Supabase anon and publishable keys, Stripe
// publishable keys, Firebase browser keys). Those are reported as fine, because
// telling someone to hide them would be wrong advice. Only keys that let a
// stranger act as the owner are treated as an emergency.

const RED = 'red';
const AMBER = 'amber';
const FINE = 'fine';

export function mask(value) {
  const s = String(value);
  const head = s.slice(0, 6);
  return `${head}… (${s.length} characters)`;
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' ? obj : null;
  } catch { return null; }
}

// Longest-match-first so sk-ant- and sk-proj- are not also caught by the
// generic OpenAI pattern.
const PATTERNS = [
  { kind: 'supabase-secret', level: RED, label: 'Supabase secret key',
    re: /\bsb_secret_[A-Za-z0-9_-]{8,}/g },
  { kind: 'supabase-publishable', level: FINE, label: 'Supabase publishable key',
    re: /\bsb_publishable_[A-Za-z0-9_-]{8,}/g },
  { kind: 'stripe-secret', level: RED, label: 'Stripe secret key',
    re: /\b(?:sk|rk)_live_[A-Za-z0-9]{10,}/g },
  { kind: 'stripe-test-secret', level: AMBER, label: 'Stripe test secret key',
    re: /\b(?:sk|rk)_test_[A-Za-z0-9]{10,}/g },
  { kind: 'stripe-publishable', level: FINE, label: 'Stripe publishable key',
    re: /\bpk_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { kind: 'anthropic', level: RED, label: 'Anthropic API key',
    re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-project', level: RED, label: 'OpenAI API key',
    re: /\bsk-proj-[A-Za-z0-9_-]{20,}/g },
  // 32+ characters so CSS class names such as sk-chase are not mistaken for keys.
  { kind: 'openai', level: RED, label: 'OpenAI API key',
    re: /\bsk-[A-Za-z0-9]{32,}/g },
  { kind: 'sendgrid', level: RED, label: 'SendGrid API key',
    re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { kind: 'resend', level: RED, label: 'Resend API key',
    re: /\bre_[A-Za-z0-9]{24,}/g },
  { kind: 'private-key-block', level: RED, label: 'Private key file',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { kind: 'google-browser-key', level: FINE, label: 'Google or Firebase browser key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
];

const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;

// sources: [{ where, text }]
export function findKeys(sources) {
  const found = [];
  const seen = new Set();

  const add = (f) => {
    const id = `${f.kind}|${f.masked}|${f.where}`;
    if (seen.has(id)) return;
    seen.add(id);
    found.push(f);
  };

  for (const { where, text } of sources) {
    if (!text) continue;
    const claimed = [];

    for (const token of text.match(JWT_RE) || []) {
      const payload = decodeJwtPayload(token);
      if (!payload) continue;
      const role = typeof payload.role === 'string' ? payload.role : null;
      const isSupabase = payload.iss === 'supabase' || typeof payload.ref === 'string';
      if (!isSupabase && !role) continue;
      claimed.push(token);
      if (role === 'service_role') {
        add({ kind: 'supabase-service-role', level: RED, label: 'Supabase service role key', where, masked: mask(token), role });
      } else if (role === 'anon') {
        add({ kind: 'supabase-anon', level: FINE, label: 'Supabase anon key', where, masked: mask(token), role });
      } else if (isSupabase) {
        add({ kind: 'supabase-unknown-role', level: AMBER, label: `Supabase key with the role "${role || 'unknown'}"`, where, masked: mask(token), role });
      }
    }

    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of text.match(p.re) || []) {
        if (claimed.some((t) => t.includes(m))) continue;
        add({ kind: p.kind, level: p.level, label: p.label, where, masked: mask(m) });
      }
    }
  }
  return found;
}

export const KEY_CHECK = {
  id: 'keys-in-javascript',
  run(site) {
    // The page's own HTML already contains its inline scripts, so it is
    // scanned once. Scanning site.inline as well would report each key twice.
    const sources = [{ where: site.finalUrl, text: site.html }];
    for (const a of site.assets) if (!a.error) sources.push({ where: a.url, text: a.body });

    const findings = findKeys(sources);
    const worst = findings.some((f) => f.level === RED) ? RED
      : findings.some((f) => f.level === AMBER) ? AMBER : 'green';
    const unread = site.assets.filter((a) => a.error).length;
    return { id: 'keys-in-javascript', level: worst, findings, unreadScripts: unread };
  },
};
