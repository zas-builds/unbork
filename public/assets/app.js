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

  // The address is kept in this browser tab only, so that coming back from
  // the payment page can re-run the same check without us storing anything.
  const REMEMBER = 'unbork:address';
  const remember = (url) => { try { sessionStorage.setItem(REMEMBER, url); } catch { /* private mode */ } };
  const remembered = () => { try { return sessionStorage.getItem(REMEMBER) || ''; } catch { return ''; } };

  const PAID_NOTE = {
    yes: 'Payment received. Here is your full report, with the fix steps and prompts. You can re-check this address free for the next seven days.',
    late: 'Payment received. Your fixes take a few seconds to register. Run the check again and they will be there.',
    no: 'The payment was not completed, so nothing has been charged.',
    bad: 'We could not confirm that payment. If money has left your account, use the contact details on our refunds page and we will put it right.',
    off: 'The full report is not on sale yet, so nothing has been charged.',
  };

  const params = new URLSearchParams(location.search);
  const paid = params.get('paid');
  if (paid && PAID_NOTE[paid]) {
    const note = h('div', { class: `paid-note ${paid === 'yes' || paid === 'late' ? 'good' : 'plainly'}`, role: 'status' },
      h('p', { text: PAID_NOTE[paid] }),
      paid === 'bad' ? h('p', {}, h('a', { href: '/refunds', text: 'Refunds and contact' })) : null);
    form.insertAdjacentElement('afterend', note);
    history.replaceState(null, '', location.pathname);
  }

  // A link like /?url=myapp.lovable.app runs the check straight away. Coming
  // back from a payment does the same thing with the address this tab kept.
  const fromLink = params.get('url') || (paid === 'yes' || paid === 'late' ? remembered() : '');
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

  // What a normal result looks like, in our own measured numbers. Someone who
  // cannot read code has no way to tell a clean report from a lazy one, and a
  // green light with no context reads like a sales pitch that failed.
  function normalResult(r) {
    const broken = r.items.filter((i) => i.group !== 'legal' && i.level !== 'info');
    const paperwork = r.items.filter((i) => i.group === 'legal' && i.level !== 'info');
    const counts = () => h('a', { href: '/guides/add-a-privacy-policy-to-a-lovable-app', text: 'the counts are here' });
    if (!broken.length && !paperwork.length) {
      return h('p', { class: 'normal' },
        'This is rarer than it sounds. Of 30 published Lovable apps we checked from outside on 18 November 2026, exactly one came back with nothing at all to fix (', counts(), ').');
    }
    if (!broken.length) {
      return h('p', { class: 'normal' },
        'Nothing about the site itself is broken, and that is the normal result rather than a let-down. Of 30 published Lovable apps we checked from outside on 18 November 2026, not one was broken, leaked a secret key or lost a page on refresh. What most of them were missing was the paperwork, which is what is left below (', counts(), ').');
    }
    return h('p', { class: 'normal' },
      'For context on how unusual this is: of 30 published Lovable apps we checked from outside on 18 November 2026, none had a problem in the breakage checks. Yours has, so it is worth dealing with (', counts(), ').');
  }

  function ghost() {
    const widths = ['82%', '64%', '91%', '48%'];
    return h('div', { class: 'locked' },
      h('div', { class: 'ghost-text', 'aria-hidden': 'true' }, widths.map((w) => { const s = h('span'); s.style.setProperty('--w', w); return s; })),
      h('div', { class: 'over' }, h('span', {}, lockIcon(), 'Fix steps and a paste-ready prompt, in the full report')));
  }

  function copyButton(text) {
    const btn = h('button', { class: 'btn ghost copy', type: 'button', text: 'Copy the prompt' });
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
      } catch {
        btn.textContent = 'Press Ctrl and C to copy';
      }
      setTimeout(() => { btn.textContent = 'Copy the prompt'; }, 2600);
    });
    return btn;
  }

  // The paid half of a finding: what to do, in order, and the prompt to paste
  // into the builder. Only ever drawn from a report the server unlocked, so
  // there is never hidden text sitting behind a blur on this page.
  function fix(f) {
    const block = h('div', { class: 'fix' }, h('h5', { text: 'What to do' }));
    if (Array.isArray(f.steps) && f.steps.length) block.append(h('ol', { class: 'fix-steps' }, f.steps.map((t) => h('li', { text: t }))));
    if (typeof f.prompt === 'string' && f.prompt.trim()) {
      block.append(h('h5', { text: 'Paste this into Lovable, Bolt or Cursor' }),
        h('pre', { class: 'prompt' }, h('code', { text: f.prompt })),
        copyButton(f.prompt));
    }
    return block;
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
    if (typeof i.guide === 'string' && /^\/guides\/[a-z0-9-]+$/.test(i.guide)) {
      body.append(h('p', { class: 'guide-link' }, h('a', { href: i.guide, text: 'Read the guide to this one' })));
    }
    const where = (i.where || []).filter(Boolean);
    const keys = i.keys || [];
    if (where.length || keys.length) {
      body.append(h('details', {}, h('summary', { text: 'Where we found it' }),
        h('ul', { class: 'where' }, where.map((w) => h('li', { text: w })), keys.map((k) => h('li', { text: `Key starts ${k}` })))));
    }
    const card = h('article', { class: 'finding' }, body);
    if (i.fix) card.append(fix(i.fix));
    else if (i.fixReady) card.append(ghost());
    return card;
  }

  function group(title, items) {
    if (!items.length) return null;
    return h('div', { class: 'group' }, h('h3', {}, title, h('span', { class: 'n', text: `(${items.length})` })), items.map(finding));
  }

  // Three states: already paid for, on sale, or not on sale yet. The page
  // never decides this for itself; it says what the server told it.
  function unlockBlock(r) {
    const full = r.full || {};
    if (!full.fixes) return null;
    if (full.unlocked) {
      return h('div', { class: 'unlock paid' },
        h('div', {}, h('h3', { text: 'Your full report is unlocked.' }),
          h('p', { text: 'Every fix above is yours to keep. Re-check this address free for seven days from when you paid, to confirm each fix worked.' })));
    }
    const head = h('div', {}, h('h3', { text: `${plural(full.fixes, 'fix', 'fixes')} ready for this site.` }),
      h('p', { text: full.onSale
        ? 'The full report gives you the steps for each problem and a prompt to paste into Lovable, Bolt or Cursor. Paid once, not a subscription, and refundable for seven days.'
        : 'The full report gives you the steps for each problem and a prompt to paste into Lovable, Bolt or Cursor. It is not on sale yet.' }));
    if (!full.onSale) {
      return h('div', { class: 'unlock' }, head, h('button', { class: 'btn', type: 'button', disabled: true, text: 'Launching soon' }));
    }
    const buy = h('button', { class: 'btn', type: 'button', text: full.price ? `Unlock for ${full.price}` : 'Unlock the full report' });
    const sayError = (t) => { const e = h('p', { class: 'buy-error', text: t }); buy.insertAdjacentElement('afterend', e); };
    buy.addEventListener('click', async () => {
      const url = r.url || r.finalUrl;
      buy.disabled = true; buy.textContent = 'Opening the payment page…';
      remember(url);
      try {
        const res = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
        const data = await res.json().catch(() => null);
        if (data && data.ok && typeof data.payUrl === 'string' && data.payUrl.startsWith('https://')) {
          location.assign(data.payUrl);
          return;
        }
        sayError((data && data.error) || 'We could not start the payment. Nothing has been charged.');
      } catch {
        sayError('We could not reach the payment page. Nothing has been charged. Check your connection and try again.');
      }
      buy.disabled = false; buy.textContent = full.price ? `Unlock for ${full.price}` : 'Unlock the full report';
    });
    return h('div', { class: 'unlock' }, head, h('div', {}, buy, h('p', { class: 'fine', text: 'Pay once for this report. No account, no subscription.' })));
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
      normalResult(r),
      group('Fix now', site.filter((i) => i.level === 'red')),
      group('Fix soon', site.filter((i) => i.level === 'amber')),
      group('Legal and privacy', legal),
      group('Worth adding', site.filter((i) => i.level === 'info')),
      r.safe && r.safe.length ? h('div', { class: 'group' }, h('h3', { text: 'What is fine' }), h('ul', { class: 'safe-list' }, r.safe.map((t) => h('li', { text: t })))) : null,
      r.notes && r.notes.length ? h('div', { class: 'group' }, h('h3', { text: 'What we could not check' }), h('ul', { class: 'note-list' }, r.notes.map((t) => h('li', { text: t })))) : null,
      unlockBlock(r),
      h('p', { class: 'disclaimer', text: 'Unbork reports what anyone can see from outside your site. It is not a security audit and not legal advice, and a clean report does not mean nothing is wrong behind a login or in your database.' })));
    out.hidden = false;
    out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    $('#report-title').focus({ preventScroll: true });
  }
})();
