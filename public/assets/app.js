// Unbork page script. Builds the report with DOM methods only (never
// innerHTML with anything from the network), so text from a scanned site can
// never run as code on this page.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const svg = (path) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = path; // fixed markup written here, never data
    return s;
  };
  const lockIcon = () => svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>');

  // Header border once the page scrolls.
  const top = $('#top');
  const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const form = $('#scan-form'), input = $('#url'), go = $('#go'), err = $('#formerr'), out = $('#report');
  document.querySelectorAll('[data-focus-bar]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(() => input.focus({ preventScroll: true }), 250);
  }));

  // A link like /?url=myapp.lovable.app runs the check straight away.
  const fromLink = new URLSearchParams(location.search).get('url');
  if (fromLink) { input.value = fromLink.slice(0, 2048); setTimeout(() => form.requestSubmit(), 50); }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    err.hidden = true;
    if (!url) { showError('Paste your live site address first, for example yourapp.lovable.app'); input.focus(); return; }
    busy(true);
    try {
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      if (res.status === 429) { showError('That is a lot of checks in a short time. Wait a minute and try again.'); return; }
      let data = null;
      try { data = await res.json(); } catch { /* handled below */ }
      if (!data) { showError('The checker did not answer properly. Try again in a minute.'); return; }
      if (!data.ok) { showError(data.error || 'We could not check that address.'); return; }
      render(data);
    } catch {
      showError('We could not reach the checker. Check your connection and try again.');
    } finally { busy(false); }
  });

  function busy(on) {
    form.classList.toggle('busy', on);
    go.disabled = on; go.textContent = on ? 'Checking…' : 'Check my site';
    form.setAttribute('aria-busy', on ? 'true' : 'false');
  }
  function showError(t) { err.textContent = t; err.hidden = false; }

  const LEVEL = { red: 'Fix now', amber: 'Fix soon', info: 'Worth knowing' };
  const DOT = { red: 'now', amber: 'soon', info: 'note' };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function headline(r) {
    const site = r.items.filter((i) => i.group !== 'legal');
    const red = site.filter((i) => i.level === 'red').length;
    const amber = site.filter((i) => i.level === 'amber').length;
    const legal = r.items.filter((i) => i.group === 'legal' && i.level !== 'info').length;
    if (r.verdict === 'green' && !legal) return 'Nothing visible from outside needs fixing.';
    const parts = [];
    if (red) parts.push(plural(red, 'thing to fix now', 'things to fix now'));
    if (amber) parts.push(plural(amber, 'to fix soon', 'to fix soon'));
    if (legal) parts.push(plural(legal, 'legal gap', 'legal gaps'));
    return parts.length ? parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.' : 'Nothing urgent, a few things worth knowing.';
  }

  function ghost() {
    const widths = ['82%', '64%', '91%', '48%'];
    return h('div', { class: 'locked' },
      h('div', { class: 'ghost-text', 'aria-hidden': 'true' }, widths.map((w) => { const s = h('span'); s.style.setProperty('--w', w); return s; })),
      h('div', { class: 'over' }, h('span', {}, lockIcon(), 'Fix steps and a paste-ready prompt, in the full report')));
  }

  function finding(i) {
    const body = h('div', { class: 'body' },
      h('div', { class: 'head' }, h('span', { class: `dot ${DOT[i.level] || 'note'}`, 'aria-hidden': 'true' }), h('h4', { text: i.headline })),
      h('p', { class: 'plain', text: i.plain }));
    if (Array.isArray(i.list) && i.list.length) body.append(h('ul', { class: 'list' }, i.list.map((t) => h('li', { text: t }))));
    for (const s of i.sources || []) {
      let link = null;
      try { const u = new URL(s.url); if (u.protocol === 'https:') link = h('a', { href: u.toString(), target: '_blank', rel: 'noopener noreferrer', text: 'Read the official source' }); } catch { /* skip a bad link */ }
      body.append(h('div', { class: 'law' },
        h('p', {}, h('strong', { text: s.law })),
        h('p', { text: s.says }),
        h('p', { class: 'applies', text: s.applies }),
        link && h('p', {}, link)));
    }
    const where = (i.where || []).filter(Boolean);
    const keys = i.keys || [];
    if (where.length || keys.length) {
      body.append(h('details', {}, h('summary', { text: 'Where we found it' }),
        h('ul', { class: 'where' }, where.map((w) => h('li', { text: w })), keys.map((k) => h('li', { text: `Key starts ${k}` })))));
    }
    const card = h('article', { class: 'finding' }, body);
    if (i.fixReady) card.append(ghost());
    return card;
  }

  function group(title, items) {
    if (!items.length) return null;
    return h('div', { class: 'group' }, h('h3', {}, title, h('span', { class: 'n', text: `(${items.length})` })), items.map(finding));
  }

  function render(r) {
    const when = new Date(r.checkedAt);
    const site = r.items.filter((i) => i.group !== 'legal');
    const legal = r.items.filter((i) => i.group === 'legal');
    const lightClass = r.verdict === 'red' ? 'red' : (r.verdict === 'amber' || legal.some((i) => i.level === 'amber')) ? 'amber' : 'green';
    const again = h('button', { class: 'btn ghost again', type: 'button', text: 'Check another site' });
    again.addEventListener('click', () => { input.value = ''; input.focus(); window.scrollTo({ top: 0 }); });

    out.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'verdict' },
        h('div', { class: `light ${lightClass}`, role: 'img', 'aria-label': lightClass === 'red' ? 'Red' : lightClass === 'amber' ? 'Amber' : 'Green' }),
        h('div', {}, h('h2', { tabindex: '-1', id: 'report-title', text: headline(r) }),
          h('p', { class: 'meta' }, h('code', { text: r.finalUrl || r.url }), `, checked ${when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`)),
        again),
      group('Fix now', site.filter((i) => i.level === 'red')),
      group('Fix soon', site.filter((i) => i.level === 'amber')),
      group('Legal and privacy', legal),
      group('Worth adding', site.filter((i) => i.level === 'info')),
      r.safe && r.safe.length ? h('div', { class: 'group' }, h('h3', { text: 'What is fine' }), h('ul', { class: 'safe-list' }, r.safe.map((t) => h('li', { text: t })))) : null,
      r.notes && r.notes.length ? h('div', { class: 'group' }, h('h3', { text: 'What we could not check' }), h('ul', { class: 'note-list' }, r.notes.map((t) => h('li', { text: t })))) : null,
      r.full && r.full.fixes ? h('div', { class: 'unlock' },
        h('div', {}, h('h3', { text: `${plural(r.full.fixes, 'fix', 'fixes')} ready for this site.` }),
          h('p', { text: 'The full report gives you the steps for each problem and a prompt to paste into Lovable, Bolt or Cursor. It is not on sale yet.' })),
        h('button', { class: 'btn', type: 'button', disabled: true, text: 'Launching soon' })) : null,
      h('p', { class: 'disclaimer', text: 'Unbork reports what anyone can see from outside your site. It is not a security audit and not legal advice, and a clean report does not mean nothing is wrong behind a login or in your database.' })));
    out.hidden = false;
    out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    $('#report-title').focus({ preventScroll: true });
  }
})();
