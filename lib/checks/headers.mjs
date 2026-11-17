// Check: the secure connection, and the few headers worth having.
//
// A missing header is not a broken app, so these never change the traffic
// light: they come back as "nice to have" and are shown apart from the things
// that need doing now. Being served over plain http is different, because
// browsers warn visitors about it, so that one is a real finding.

import { isPrivateHost } from '../url.mjs';

const SUGGESTIONS = [
  { key: 'strict-transport-security',
    has: (h) => Boolean(h['strict-transport-security']),
    text: 'Tell browsers to always use the secure version of your site (a header called Strict-Transport-Security). Without it, the very first visit can be sent over an unprotected connection.' },
  { key: 'frames',
    has: (h) => Boolean(h['x-frame-options']) || /frame-ancestors/i.test(h['content-security-policy'] || ''),
    text: 'Stop other websites loading your app inside their own page (a header called X-Frame-Options). Without it, someone can wrap your login screen in a copy of your site and collect what people type.' },
  { key: 'x-content-type-options',
    has: (h) => /nosniff/i.test(h['x-content-type-options'] || ''),
    text: 'Stop browsers guessing what kind of file they have been sent (a header called X-Content-Type-Options, set to nosniff).' },
];

export const HEADERS_CHECK = {
  id: 'connection',
  run(site) {
    const items = [], safe = [], notes = [];
    const headers = site.headers || {};
    // Plain http only matters for an address the public can reach. A local
    // address is refused long before this in production, and warning about
    // one would be meaningless.
    let secure = false, insecure = false;
    try {
      const u = new URL(site.finalUrl);
      secure = u.protocol === 'https:';
      insecure = u.protocol === 'http:' && !isPrivateHost(u.hostname);
    } catch { /* an address we cannot parse is left alone */ }

    if (insecure) {
      items.push({
        id: 'no-https',
        level: 'red',
        headline: 'Your site is not using a secure connection',
        plain: 'Your site is served over http rather than https, so browsers show visitors a “Not secure” warning and anything they type can be read on the way. Almost every host turns this on with one setting.',
        where: [site.finalUrl],
      });
    } else if (secure) {
      safe.push('Your site is served over a secure connection (https).');
    }

    const missing = SUGGESTIONS.filter((s) => !s.has(headers));
    if (missing.length && !insecure) {
      items.push({
        id: 'headers',
        level: 'info',
        headline: missing.length === 1 ? 'One security setting is worth adding' : `${missing.length} security settings are worth adding`,
        plain: 'None of these is urgent and your app works without them. They are one-line settings your host can add.',
        list: missing.map((s) => s.text),
        where: [],
      });
    } else if (!missing.length) {
      safe.push('The security headers we look for are all in place.');
    }
    return { id: 'connection', level: insecure ? 'red' : 'green', items, safe, notes };
  },
};
