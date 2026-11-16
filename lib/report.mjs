// Turns check results into plain English a non-coder can act on.

const EMERGENCY = {
  'supabase-service-role': {
    headline: 'Anyone who opens your site can take over your database',
    plain: 'Your site is handing out a Supabase service role key. That key ignores all of your security rules, so a stranger can read, change or delete everything in your database, including other people’s data.',
  },
  'supabase-secret': {
    headline: 'Anyone who opens your site can take over your database',
    plain: 'Your site is handing out a Supabase secret key. That key ignores all of your security rules, so a stranger can read, change or delete everything in your database.',
  },
  'stripe-secret': {
    headline: 'Your live Stripe key is in your site’s code',
    plain: 'Your site is handing out a Stripe secret key for live mode. A stranger can use it to see your customers and move real money.',
  },
  'anthropic': {
    headline: 'Your AI key is in your site’s code',
    plain: 'Your site is handing out your Anthropic API key. Anyone can use it and the bill comes to you.',
  },
  'openai': {
    headline: 'Your AI key is in your site’s code',
    plain: 'Your site is handing out your OpenAI API key. Anyone can use it and the bill comes to you.',
  },
  'openai-project': {
    headline: 'Your AI key is in your site’s code',
    plain: 'Your site is handing out your OpenAI API key. Anyone can use it and the bill comes to you.',
  },
  'sendgrid': {
    headline: 'Your email key is in your site’s code',
    plain: 'Your site is handing out your SendGrid key. Anyone can send email that looks like it came from you.',
  },
  'resend': {
    headline: 'Your email key is in your site’s code',
    plain: 'Your site is handing out your Resend key. Anyone can send email that looks like it came from you.',
  },
  'private-key-block': {
    headline: 'A private key file is in your site’s code',
    plain: 'Your site is serving a private key. Whatever it unlocks should be treated as compromised.',
  },
};

const FINE_NOTE = {
  'supabase-anon': 'Your Supabase anon key is in the code. That is normal and safe: it is meant to be public, and your security rules are what keep your data private.',
  'supabase-publishable': 'Your Supabase publishable key is in the code. That is normal and safe: it is meant to be public.',
  'stripe-publishable': 'Your Stripe publishable key is in the code. That is normal and safe: it is designed to be seen by shoppers.',
  'google-browser-key': 'A Google or Firebase browser key is in the code. That is normal: those keys are meant to be public, and are protected by your Firebase rules and key restrictions rather than by hiding them.',
};

export function buildReport(site, results) {
  const items = [];
  const safe = [];
  const notes = [];

  for (const r of results) {
    if (r.id !== 'keys-in-javascript') continue;

    const emergencies = r.findings.filter((f) => f.level === 'red');
    const grouped = new Map();
    for (const f of emergencies) {
      const copy = EMERGENCY[f.kind] || {
        headline: 'A secret key is in your site’s code',
        plain: `Your site is handing out a ${f.label}. Anyone who opens your site can use it as if they were you.`,
      };
      // One card per headline. Two kinds of Supabase key that cause the same
      // harm should read as one problem, not two.
      if (!grouped.has(copy.headline)) {
        grouped.set(copy.headline, { ...copy, id: f.kind, kinds: [], level: 'red', where: [], keys: [] });
      }
      const g = grouped.get(copy.headline);
      if (!g.kinds.includes(f.kind)) g.kinds.push(f.kind);
      if (!g.where.includes(f.where)) g.where.push(f.where);
      g.keys.push(f.masked);
    }
    for (const g of grouped.values()) items.push(g);

    for (const f of r.findings.filter((x) => x.level === 'amber')) {
      items.push({
        id: f.kind,
        level: 'amber',
        headline: 'A test key is in your site’s code',
        plain: `Your site is handing out a ${f.label}. It cannot move real money or touch live data, but it should not be published.`,
        where: [f.where],
        keys: [f.masked],
      });
    }

    for (const f of r.findings.filter((x) => x.level === 'fine')) {
      const text = FINE_NOTE[f.kind];
      if (text && !safe.includes(text)) safe.push(text);
    }

    if (!emergencies.length) {
      safe.unshift('We read your site’s JavaScript and found no key that lets a stranger act as you.');
    }
    if (r.unreadScripts) {
      notes.push(`${r.unreadScripts} of your JavaScript files would not load in time, so they were not checked.`);
    }
    if (site.scriptsFound > site.scriptsFetched + r.unreadScripts) {
      notes.push('Your site loads more JavaScript files than we check in one pass, so a few were skipped.');
    }
  }

  const verdict = items.some((i) => i.level === 'red') ? 'red'
    : items.some((i) => i.level === 'amber') ? 'amber' : 'green';

  return {
    ok: true,
    url: site.requestedUrl,
    finalUrl: site.finalUrl,
    status: site.status,
    checkedAt: new Date().toISOString(),
    ms: site.ms,
    verdict,
    items,
    safe,
    notes,
    checksRun: results.map((r) => r.id),
    scripts: { found: site.scriptsFound, read: site.scriptsFetched },
  };
}
