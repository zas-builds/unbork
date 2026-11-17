// Shared reading of a page's shape, used by more than one check.
//
// None of this executes JavaScript. Every conclusion here has to be provable
// from the bytes the host sent, because a check that guesses is worse than no
// check at all for someone who cannot read the code themselves.

// The container a single-page app draws itself into. These are the ids the
// common vibe-coding stacks produce: Vite and Create React App use "root",
// Vue and the Lovable starter use "app", Next and Nuxt use their own.
const MOUNT_IDS = new Set(['root', 'app', '__next', '__nuxt', 'app-root', 'q-app']);

// Returns the id of an empty mount container, or null.
// A container with anything inside it is treated as filled, which is the
// cautious direction: we only ever claim "empty" when it provably is.
export function emptyMount(html) {
  const re = /<(div|main|section)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const idm = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2] || '');
    const id = String((idm && (idm[1] ?? idm[2] ?? idm[3])) || '').toLowerCase();
    if (!MOUNT_IDS.has(id)) continue;
    if (m[3].trim() === '') return id;
  }
  return null;
}

// Roughly what a reader would see with JavaScript turned off.
export function visibleText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The raw src attribute values, as written in the HTML, so a fallback page can
// be recognised by the bundle it points at.
export function rawScriptSrcs(html) {
  const out = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = String(m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

export function hasAnyScript(site) {
  return site.scriptsFound > 0 || (site.inline && site.inline.length > 0);
}

// Is this a single-page app: an empty container plus JavaScript expected to
// fill it? Both halves are required, so a plain HTML page is never mistaken
// for one.
export function singlePageApp(site) {
  const mount = emptyMount(site.html);
  const text = visibleText(site.html);
  const scripts = hasAnyScript(site);
  // A page can also be a single-page app without one of the known ids, if it
  // ships JavaScript and shows a reader almost nothing. 120 characters is
  // about two short sentences: below that there is no page without the script.
  const bare = scripts && text.length < 120;
  return { isSpa: Boolean(scripts && (mount || bare)), mount, textLength: text.length };
}

// Does this response look like the same app shell as the home page? That is
// what a working single-page-app fallback serves for every address.
export function looksLikeSameApp(body, html) {
  if (!body) return false;
  if (body === html) return true;
  const srcs = rawScriptSrcs(html);
  if (srcs.length && srcs.some((s) => body.includes(s))) return true;
  const mount = emptyMount(html);
  if (mount && new RegExp(`id\\s*=\\s*["']?${mount}["']?`, 'i').test(body) && /<script\b/i.test(body)) return true;
  return false;
}
