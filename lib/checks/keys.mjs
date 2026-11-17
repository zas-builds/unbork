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

// Plain English for each kind of key. Grouped by headline, because two kinds
// of Supabase key that cause the same harm should read as one problem.
const EMERGENCY = {
  'supabase-service-role': {
    headline: 'Anyone who opens your site can take over your database',
    plain: 'Your site is handing out a Supabase service role key. That key ignores all of your security rules, so a stranger can read, change or delete everything in your database, including other people\u2019s data.',
  },
  'supabase-secret': {
    headline: 'Anyone who opens your site can take over your database',
    plain: 'Your site is handing out a Supabase secret key. That key ignores all of your security rules, so a stranger can read, change or delete everything in your database.',
  },
  'stripe-secret': {
    headline: 'Your live Stripe key is in your site\u2019s code',
    plain: 'Your site is handing out a Stripe secret key for live mode. A stranger can use it to see your customers and move real money.',
  },
  'anthropic': {
    headline: 'Your AI key is in your site\u2019s code',
    plain: 'Your site is handing out your Anthropic API key. Anyone can use it and the bill comes to you.',
  },
  'openai': {
    headline: 'Your AI key is in your site\u2019s code',
    plain: 'Your site is handing out your OpenAI API key. Anyone can use it and the bill comes to you.',
  },
  'openai-project': {
    headline: 'Your AI key is in your site\u2019s code',
    plain: 'Your site is handing out your OpenAI API key. Anyone can use it and the bill comes to you.',
  },
  'sendgrid': {
    headline: 'Your email key is in your site\u2019s code',
    plain: 'Your site is handing out your SendGrid key. Anyone can send email that looks like it came from you.',
  },
  'resend': {
    headline: 'Your email key is in your site\u2019s code',
    plain: 'Your site is handing out your Resend key. Anyone can send email that looks like it came from you.',
  },
  'private-key-block': {
    headline: 'A private key file is in your site\u2019s code',
    plain: 'Your site is serving a private key. Whatever it unlocks should be treated as compromised.',
  },
};

const FINE_NOTE = {
  'supabase-anon': 'Your Supabase anon key is in the code. That is normal and safe: it is meant to be public, and your security rules are what keep your data private.',
  'supabase-publishable': 'Your Supabase publishable key is in the code. That is normal and safe: it is meant to be public.',
  'stripe-publishable': 'Your Stripe publishable key is in the code. That is normal and safe: it is designed to be seen by shoppers.',
  'google-browser-key': 'A Google or Firebase browser key is in the code. That is normal: those keys are meant to be public, and are protected by your Firebase rules and key restrictions rather than by hiding them.',
};

export const KEY_CHECK = {
  id: 'keys-in-javascript',
  run(site) {
    // The page's own HTML already contains its inline scripts, so it is
    // scanned once. Scanning site.inline as well would report each key twice.
    const sources = [{ where: site.finalUrl, text: site.html }];
    for (const a of site.assets) if (!a.error) sources.push({ where: a.url, text: a.body });

    const findings = findKeys(sources);
    const items = [], safe = [], notes = [];

    const grouped = new Map();
    for (const f of findings.filter((x) => x.level === RED)) {
      const copy = EMERGENCY[f.kind] || {
        headline: 'A secret key is in your site\u2019s code',
        plain: `Your site is handing out a ${f.label}. Anyone who opens your site can use it as if they were you.`,
      };
      if (!grouped.has(copy.headline)) {
        grouped.set(copy.headline, { ...copy, id: f.kind, kinds: [], level: 'red', where: [], keys: [] });
      }
      const g = grouped.get(copy.headline);
      if (!g.kinds.includes(f.kind)) g.kinds.push(f.kind);
      if (!g.where.includes(f.where)) g.where.push(f.where);
      g.keys.push(f.masked);
    }
    for (const g of grouped.values()) items.push(g);

    for (const f of findings.filter((x) => x.level === AMBER)) {
      items.push({
        id: f.kind,
        level: 'amber',
        headline: 'A test key is in your site\u2019s code',
        plain: `Your site is handing out a ${f.label}. It cannot move real money or touch live data, but it should not be published.`,
        where: [f.where],
        keys: [f.masked],
      });
    }

    for (const f of findings.filter((x) => x.level === FINE)) {
      const text = FINE_NOTE[f.kind];
      if (text && !safe.includes(text)) safe.push(text);
    }

    const unread = site.assets.filter((a) => a.error).length;
    if (!grouped.size) {
      safe.unshift('We read your site\u2019s JavaScript and found no key that lets a stranger act as you.');
    }
    if (unread) {
      notes.push(`${unread} of your JavaScript files would not load in time, so they were not checked.`);
    }
    if (site.scriptsFound > site.scriptsFetched + unread) {
      notes.push('Your site loads more JavaScript files than we check in one pass, so a few were skipped.');
    }

    const worst = findings.some((f) => f.level === RED) ? RED
      : findings.some((f) => f.level === AMBER) ? AMBER : 'green';
    return { id: 'keys-in-javascript', level: worst, findings, items, safe, notes, unreadScripts: unread };
  },
};
