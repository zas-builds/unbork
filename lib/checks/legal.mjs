// Check: the legal basics anyone outside can see.
//
// What this is: evidence from the bytes your host sends (your page, its
// JavaScript, and any small privacy or terms file it points at). What it is
// not: legal advice, or a verdict that a site is "compliant". We never claim
// a policy is good or bad, only whether we could find one, and every finding
// names the rule it rests on, with the official source (lib/rules.mjs).
//
// Nothing here is ever "red". A missing privacy policy is a real problem, but
// it does not stop the app working, and we will not put it on the same level
// as a leaked database key.

import { source } from '../rules.mjs';

// Tools that store an identifier on the visitor's device by default.
const TRACKERS = [
  { name: 'Google Analytics', ads: false, re: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(?:analytics|ga|urchin)\.js|gtag\(\s*["']config["']\s*,\s*["']G-/ },
  { name: 'Google Tag Manager', ads: false, re: /googletagmanager\.com\/gtm\.js/ },
  { name: 'Meta Pixel', ads: true, re: /connect\.facebook\.net\/[^"'`\s]*\/fbevents\.js|fbq\(\s*["']init["']/ },
  { name: 'Google Ads', ads: true, re: /googleads\.g\.doubleclick\.net|googlesyndication\.com|gtag\(\s*["']config["']\s*,\s*["']AW-/ },
  { name: 'TikTok Pixel', ads: true, re: /analytics\.tiktok\.com/ },
  { name: 'LinkedIn Insight', ads: true, re: /snap\.licdn\.com\/li\.lms-analytics/ },
  { name: 'X (Twitter) Pixel', ads: true, re: /static\.ads-twitter\.com/ },
  { name: 'Reddit Pixel', ads: true, re: /redditstatic\.com\/ads\/pixel/ },
  { name: 'Hotjar', ads: false, re: /static\.hotjar\.com|script\.hotjar\.com/ },
  { name: 'Microsoft Clarity', ads: false, re: /clarity\.ms\/tag/ },
  { name: 'Mixpanel', ads: false, re: /cdn\.mxpnl\.com|api-js\.mixpanel\.com/ },
  { name: 'Segment', ads: false, re: /cdn\.segment\.com\/analytics\.js/ },
  { name: 'PostHog', ads: false, re: /\.posthog\.com|posthog\.init\(/ },
];

// Consent tools, and the words a home-made banner uses.
const CONSENT = /cookiebot|cookielaw\.org|onetrust|cookieyes|iubenda|termly|usercentrics|osano|klaro|didomi|consentmanager|complianz|cookie-script|tarteaucitron|axeptio|cc_cookie|vanilla-cookieconsent|cookieconsent|gtag\(\s*["']consent["']/i;
const BANNER_WORDS = /accept (?:all )?cookies|reject (?:all )?cookies|reject all|cookie (?:preferences|settings)|we use cookies|manage cookies|allow (?:all )?cookies/i;

const TRACKING_COOKIE = /^(?:_ga|_gid|_gcl_|_fbp|_fbc|_hj|_clck|_clsk|ajs_|mp_|_ttp|li_|_uetsid|_uetvid)/i;

const PAYMENTS = [
  { name: 'Razorpay', re: /checkout\.razorpay\.com|razorpay\.com\/v1\/checkout/ },
  { name: 'Stripe', re: /js\.stripe\.com|buy\.stripe\.com|checkout\.stripe\.com/ },
  { name: 'Paddle', re: /cdn\.paddle\.com/ },
  { name: 'Lemon Squeezy', re: /lemonsqueezy\.com/ },
  { name: 'PayPal', re: /paypal\.com\/sdk\/js|paypalobjects\.com/ },
];

// Signs the site collects personal data: sign-in, sign-up, forms with email.
const ACCOUNTS = /type\s*=\s*["']?(?:email|password)\b|signInWithPassword|signInWithOtp|signInWithOAuth|auth\.signUp\(|createUserWithEmailAndPassword|signInWithEmailAndPassword|clerk\.(?:com|accounts)|auth0\.com|\bnewsletter\b/i;

const ROUTE = (words) => new RegExp(`["'\`](?:/|https?://[^"'\`\\s]*?/)(?:[\\w-]+/)?(?:${words})(?:[/?#][^"'\`\\s]*)?["'\`]`, 'i');
const PRIVACY_ROUTE = ROUTE('privacy|privacy-policy|privacypolicy|privacy-notice|datenschutz|confidentialite|politica-de-privacidad|privacidad');
const PRIVACY_HOSTED = /iubenda\.com\/privacy-policy|app\.termly\.io\/(?:document|policy-viewer)|termsfeed\.com\/live|privacypolicies\.com\/live|getterms\.io|freeprivacypolicy\.com\/live/i;
const PRIVACY_WORDS = /privacy policy|privacy notice|datenschutzerkl|politique de confidentialit|pol[ií]tica de privacidad/i;
const TERMS_ROUTE = ROUTE('terms|terms-of-service|terms-of-use|terms-and-conditions|terms-conditions|tos|agb|conditions');
const TERMS_WORDS = /terms of service|terms of use|terms (?:and|&) conditions|nutzungsbedingungen|conditions g[ée]n[ée]rales/i;
const REFUND_ROUTE = ROUTE('refund|refunds|refund-policy|cancellation|cancellation-policy|returns|return-policy|cancellation-and-refund|cancellation-refund');
const REFUND_WORDS = /refund policy|cancellation policy|cancellation (?:and|&) refund|return policy/i;
const CONTACT = /mailto:|["'`]\/contact(?:-us)?["'`/?#]|contact us/i;
const DNS_LINK = /do not sell or share/i;

function corpus(site) {
  const parts = [site.html || ''];
  for (const a of site.assets || []) if (!a.error && a.status < 400 && a.body) parts.push(a.body);
  for (const a of site.legalAssets || []) if (!a.error && a.status < 400 && a.body) parts.push(a.body);
  return parts.join('\n');
}

const chunkNamed = (site, re) => (site.legalAssets || []).some((a) => !a.error && a.status < 400 && re.test(a.url));

export const LEGAL_CHECK = {
  id: 'legal-basics',
  run(site) {
    const items = [], safe = [], notes = [];
    const text = corpus(site);

    const trackers = TRACKERS.filter((t) => t.re.test(text));
    const payments = PAYMENTS.filter((p) => p.re.test(text));
    const consent = CONSENT.test(text) || BANNER_WORDS.test(text);
    const accounts = ACCOUNTS.test(text);
    const collects = accounts || trackers.length > 0 || payments.length > 0;

    const privacy = PRIVACY_ROUTE.test(text) || PRIVACY_HOSTED.test(text) || chunkNamed(site, /privacy|datenschutz/i) ? 'strong'
      : PRIVACY_WORDS.test(text) ? 'weak' : 'none';
    const terms = TERMS_ROUTE.test(text) || chunkNamed(site, /terms|agb/i) ? 'strong' : TERMS_WORDS.test(text) ? 'weak' : 'none';
    const refund = REFUND_ROUTE.test(text) || chunkNamed(site, /refund|cancellation|returns/i) ? 'strong' : REFUND_WORDS.test(text) ? 'weak' : 'none';
    const contact = CONTACT.test(text);

    const why = [];
    if (accounts) why.push('sign-in or email forms');
    if (trackers.length) why.push(trackers.map((t) => t.name).join(', '));
    if (payments.length) why.push(`payments through ${payments.map((p) => p.name).join(' and ')}`);

    // 1. Privacy policy
    if (privacy === 'none') {
      items.push({
        id: 'no-privacy-policy',
        group: 'legal',
        level: collects ? 'amber' : 'info',
        headline: collects ? 'We could not find a privacy policy' : 'No privacy policy that we could see',
        plain: collects
          ? `Your site collects information about the people who use it (we saw ${why.join('; ')}), but nowhere in your page or its code did we find a privacy policy or a link to one. In the EU and UK the law requires you to tell people what you collect and why at the moment you collect it, and India’s new rules require a notice too.`
          : 'We found no privacy policy or link to one. We also saw no sign-in, forms, tracking or payments, so your site may collect very little. If it does collect anything, even an email address, you need one.',
        where: [site.finalUrl],
        sources: collects ? [source('gdpr-art13'), source('dpdp-notice')] : [source('gdpr-art13')],
      });
    } else if (privacy === 'weak') {
      notes.push('We saw the words “privacy policy” in your code but no link to a page, so we cannot tell whether a policy exists. Check it is linked from your home page, usually in the footer.');
    } else {
      safe.push('Your site links to a privacy policy. We have not judged what it says, only that it is there.');
    }

    // 2. Tracking without a consent tool
    const cookieTrackers = trackers;
    if (cookieTrackers.length && !consent) {
      items.push({
        id: 'tracking-without-consent',
        group: 'legal',
        level: 'amber',
        headline: 'Your site uses tracking tools, and we found no cookie consent',
        plain: `Your site loads ${cookieTrackers.map((t) => t.name).join(', ')}. ${cookieTrackers.length === 1 ? 'This tool stores' : 'These tools store'} an identifier on each visitor’s device. In the UK and EU that needs the visitor’s agreement first, and we found no consent banner or consent tool anywhere in your code.`,
        where: [site.finalUrl],
        sources: [source('pecr-cookies')],
      });
    } else if (cookieTrackers.length) {
      notes.push(`Your site loads ${cookieTrackers.map((t) => t.name).join(', ')} and has a cookie consent tool. We cannot see from outside whether the tracking waits for a visitor’s yes, so test it once: open your site in a private window, refuse cookies, and check no tracking cookies appear.`);
    } else {
      safe.push('We found none of the common tracking tools (analytics or advertising pixels) on your site.');
    }

    // 3. Tracking cookies set by the server before anyone could agree
    const early = (site.setCookies || []).map((c) => String(c).split('=')[0].trim()).filter((n) => TRACKING_COOKIE.test(n));
    if (early.length) {
      items.push({
        id: 'tracking-cookie-on-arrival',
        group: 'legal',
        level: 'amber',
        headline: 'A tracking cookie is set the moment someone arrives',
        plain: `Your server sets ${early.join(', ')} on the very first response, before a visitor could have agreed to anything. In the UK and EU, non-essential cookies must wait for consent.`,
        where: [site.finalUrl],
        sources: [source('pecr-cookies')],
      });
    }

    // 4. Taking money without the pages payment providers and buyers expect
    const razorpay = payments.some((p) => p.name === 'Razorpay');
    if (payments.length) {
      const missing = [];
      if (terms === 'none') missing.push('terms and conditions');
      if (refund === 'none') missing.push('a cancellation and refund policy');
      if (privacy === 'none') missing.push('a privacy policy');
      if (!contact) missing.push('a way to contact you');
      if (missing.length) {
        items.push({
          id: 'payment-pages-missing',
          group: 'legal',
          level: razorpay ? 'amber' : 'info',
          headline: razorpay ? 'Razorpay asks for pages we could not find' : 'You take payments, but some buyer-facing pages are missing',
          plain: razorpay
            ? `Your site uses Razorpay. Razorpay asks for links to these pages when it reviews a website, and we could not find: ${missing.join(', ')}. A missing page can hold up or stop your account being approved.`
            : `Your site takes payments through ${payments.map((p) => p.name).join(' and ')}, and we could not find: ${missing.join(', ')}. Buyers look for these before paying, and most payment providers expect them.`,
          where: [site.finalUrl],
          sources: razorpay ? [source('razorpay-pages')] : [],
        });
      } else {
        safe.push('You take payments, and we found terms, a refund policy, a privacy policy and a way to contact you.');
      }
    }

    // 5. Advertising pixels and the California opt-out link
    const adPixels = trackers.filter((t) => t.ads);
    if (adPixels.length && !DNS_LINK.test(text)) {
      items.push({
        id: 'ccpa-optout-missing',
        group: 'legal',
        level: 'info',
        headline: 'No “Do Not Sell or Share” link for California',
        plain: `Your site loads ${adPixels.map((t) => t.name).join(', ')}, which passes visitor information to an advertising network. California’s privacy law treats that as sharing, and covered businesses must show a link titled “Do Not Sell or Share My Personal Information”. The law only applies above its size thresholds, so for most small apps this is something to know rather than fix today.`,
        where: [site.finalUrl],
        sources: [source('ccpa-optout')],
      });
    }

    // 6. Accounts with no terms
    if (accounts && !payments.length && terms === 'none') {
      items.push({
        id: 'no-terms',
        group: 'legal',
        level: 'info',
        headline: 'People can sign up, but we found no terms',
        plain: 'Your site has sign-in or sign-up, and we found no terms of service. No law requires terms for every app, but without them you have no written rules for how people may use your service, or what you are responsible for if something goes wrong.',
        where: [site.finalUrl],
        sources: [],
      });
    }

    notes.push('The legal part of this report is information, not legal advice. It shows what anyone can see from outside; it cannot see what your code does with data once it has it.');

    const level = items.some((i) => i.level === 'amber') ? 'amber' : 'green';
    return { id: 'legal-basics', level, items, safe, notes, signals: { trackers: trackers.map((t) => t.name), payments: payments.map((p) => p.name), consent, accounts, privacy, terms, refund, contact } };
  },
};
