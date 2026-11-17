// Check: was the app published with its settings left unfilled?
//
// Only placeholders that cannot be anything else are reported. Patterns that
// might be ordinary code are deliberately left out: a false alarm is worse
// than silence for someone who cannot check the code themselves.
//
// Everything found here is one problem with one cause (the app was published
// before its settings were filled in), so it is one card with a list, not a
// card for each pattern that happened to match.

const PLACEHOLDERS = [
  { re: /\bundefined\.supabase\.co/g,
    detail: 'Your app is trying to reach a database address that reads “undefined” instead of your project, so every part of your app that touches the database will fail.' },
  { re: /\byour-project(?:-id)?\.supabase\.co/gi,
    detail: 'Your app still points at the example database address from the documentation rather than your own project, so nothing it saves or reads will work.' },
  { re: /\bYOUR[_-](?:SUPABASE|API|ANON|SECRET|PROJECT|PUBLIC|STRIPE|OPENAI)[A-Z_]*\b/g,
    detail: 'Your app still contains the name of a setting where its value should be, so whatever that setting is for will not work.' },
  { re: /["'](?:your[_-]anon[_-]key|your[_-]api[_-]key|changeme|xxxxxxxx+)["']/gi,
    detail: 'Your app still contains a placeholder value where a real one should be, so the feature that uses it will not work.' },
];

// Only a localhost address that is plainly being used as an address to fetch
// from. A bare mention is not enough: a sample of six real, working Lovable
// apps on 17 Nov had "http://localhost" somewhere in the bundle on three of
// them, all of them fine, because the generated code and the libraries it
// bundles compare against it to tell development from production. Reporting
// that would be a false alarm on half of all healthy sites.
const LOCAL_API = /(?:fetch\s*\(|base_?url|api_?url|api_?base|api_?host|endpoint|supabase_?url)\s*[:=(]?\s*["'`]\s*https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi;

function matchIn(re, sources) {
  const where = [];
  for (const s of sources) {
    re.lastIndex = 0;
    if (s.text && re.test(s.text) && !where.includes(s.where)) where.push(s.where);
  }
  return where;
}

export const SETTINGS_CHECK = {
  id: 'settings-filled',
  run(site) {
    const items = [], safe = [], notes = [];
    const sources = [{ where: site.finalUrl, text: site.html }];
    for (const a of site.assets) if (!a.error && a.status < 400) sources.push({ where: a.url, text: a.body });

    const details = [], places = [];
    for (const p of PLACEHOLDERS) {
      const where = matchIn(p.re, sources);
      if (!where.length) continue;
      details.push(p.detail);
      for (const w of where) if (!places.includes(w)) places.push(w);
    }

    if (details.length) {
      items.push({
        id: 'placeholder-settings',
        level: 'red',
        headline: details.length === 1
          ? 'Your app was published with a setting left blank'
          : 'Your app was published with settings left blank',
        plain: details.length === 1
          ? details[0]
          : 'Your published app still has places where a real value should be. Each one has to be filled in and the app published again.',
        list: details.length === 1 ? [] : details,
        where: places,
      });
    }

    const local = matchIn(LOCAL_API, sources);
    if (local.length) {
      items.push({
        id: 'local-address',
        level: 'amber',
        headline: 'Your published app asks your own computer for data',
        plain: 'Your published code fetches data from http://localhost, an address that only exists on the machine the code was written on. For anyone else that request fails, so whatever it was fetching will be missing, or the page will sit there loading. If that part of the app is not in use yet, nothing is broken today.',
        where: local,
      });
    }

    if (!items.length) safe.push('We found no settings left as placeholders in your published code.');
    const level = details.length ? 'red' : items.length ? 'amber' : 'green';
    return { id: 'settings-filled', level, items, safe, notes };
  },
};
