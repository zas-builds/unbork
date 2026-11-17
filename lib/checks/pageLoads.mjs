// Check: can the page load at all?
//
// Only things that are certain from outside are reported here. We cannot run
// anyone's JavaScript, so we never claim a page "is blank". We claim it only
// where the cause is in the bytes the host sent: an error instead of the app,
// a file the page asks for that does not exist, or a shell with nothing to
// fill it.

import { emptyMount, hasAnyScript, visibleText } from '../shell.mjs';

export const PAGE_LOADS_CHECK = {
  id: 'page-loads',
  run(site) {
    const items = [], safe = [], notes = [];

    if (site.status >= 500) {
      items.push({
        id: 'server-error',
        level: 'red',
        headline: 'Your site answers with an error instead of your app',
        plain: `Opening your address returns the error code ${site.status}, which means your host tried to serve your app and something failed. Nobody can use the app until that stops.`,
        where: [site.finalUrl],
      });
    } else if (site.status >= 400) {
      items.push({
        id: 'not-found',
        level: 'red',
        headline: `Your address answers “${site.status}”, not your app`,
        plain: `Opening your address returns the code ${site.status}. Either nothing is published at this address, or it is published somewhere slightly different. Check the address is exactly the one your host shows you.`,
        where: [site.finalUrl],
      });
    }

    const broken = site.assets.filter((a) => !a.error && a.status >= 400);
    if (broken.length) {
      items.push({
        id: 'missing-script',
        level: 'red',
        headline: broken.length === 1 ? 'A file your app needs is missing' : 'Files your app needs are missing',
        plain: broken.length === 1
          ? 'Your page asks the browser for a JavaScript file that your host answers with an error. That file is your app, so visitors get a blank or half-drawn page. This usually means the published files and the page asking for them came from two different builds.'
          : `Your page asks the browser for ${broken.length} JavaScript files that your host answers with an error. Those files are your app, so visitors get a blank or half-drawn page. This usually means the published files and the page asking for them came from two different builds.`,
        where: broken.map((a) => `${a.url} (${a.status})`),
      });
    }

    const mount = emptyMount(site.html);
    if (site.status < 400 && !hasAnyScript(site) && (mount || visibleText(site.html).length < 40)) {
      items.push({
        id: 'nothing-to-render',
        level: 'red',
        headline: 'Your page has nothing on it',
        plain: mount
          ? `Your page is an empty container that JavaScript is meant to fill in, but it does not load any JavaScript at all. Every visitor sees a blank screen. The published folder is probably the wrong one: the built files, not the source.`
          : 'Your page arrived with almost nothing in it, and no JavaScript to add anything. Every visitor sees a blank screen.',
        where: [site.finalUrl],
      });
    }

    if (!items.length && site.status < 400) {
      const unread = site.assets.filter((a) => a.error).length;
      if (!unread) safe.push('Your page and every JavaScript file it asks for loaded without an error.');
    }
    return { id: 'page-loads', level: items.length ? 'red' : 'green', items, safe, notes };
  },
};
