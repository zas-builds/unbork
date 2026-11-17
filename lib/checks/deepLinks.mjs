// Check: does a link inside the app survive a refresh or a share?
//
// A single-page app draws every page with JavaScript loaded from one address.
// The host has to answer every unknown path with that same app shell. If it
// answers "not found" instead, the home page works but every other page
// breaks the moment someone refreshes it or opens a shared link. This is one
// of the most common complaints from people who build with Lovable or Bolt
// and then host the result somewhere that does not have the rewrite rule.

import { singlePageApp, looksLikeSameApp } from '../shell.mjs';

export const DEEP_LINK_CHECK = {
  id: 'deep-links',
  run(site) {
    const items = [], safe = [], notes = [];
    const probe = site.probe;

    if (!probe || probe.error) {
      notes.push('We could not test what happens when someone refreshes a page inside your app, so that is not part of this report.');
      return { id: 'deep-links', level: 'green', items, safe, notes };
    }

    const spa = singlePageApp(site);
    const servesApp = probe.status === 200 && looksLikeSameApp(probe.body, site.html);

    if (servesApp) {
      safe.push('Links inside your app keep working when someone refreshes the page or opens a link you shared.');
      return { id: 'deep-links', level: 'green', items, safe, notes };
    }

    if (!spa.isSpa) {
      if (probe.status === 404) {
        safe.push('Your site answers an address that does not exist with a proper “not found” page, which is the correct behaviour for a site like yours.');
      } else {
        notes.push(`An address that does not exist on your site answers with ${probe.status} rather than “not found”. That is unusual but it is not a fault we can be sure about from outside.`);
      }
      return { id: 'deep-links', level: 'green', items, safe, notes };
    }

    const what = probe.status === 404 ? 'a “not found” error' : `the code ${probe.status}`;
    items.push({
      id: 'deep-links',
      level: 'red',
      headline: 'Refreshing or sharing any page except your home page shows an error',
      plain: `Your app draws all of its pages with JavaScript, so your host has to hand back the app for every address. Yours hands back ${what} instead. Your home page works, but anyone who refreshes a page inside your app, or opens a link you sent them, sees an error page rather than your app.`,
      where: [probe.url],
    });
    return { id: 'deep-links', level: 'red', items, safe, notes };
  },
};
