// Every legal statement Unbork makes points at one of these sources.
//
// Rules: a source is the official text or the regulator's own page, never a
// blog. "verified" is the date someone last opened the link and confirmed it
// still says what we rely on. `npm run audit-rules` lists any older than 90
// days so the scheduled run re-checks them. If a source cannot be confirmed,
// the finding that uses it is switched off rather than left standing.

export const RULES = {
  'gdpr-art13': {
    law: 'EU and UK GDPR, Article 13',
    says: 'When you collect personal data from someone, you must tell them who you are, how to contact you, why you collect it and on what legal basis, who receives it, how long you keep it, and what rights they have.',
    applies: 'If people in the EU or UK use your site.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    verified: '2026-11-17',
  },
  'pecr-cookies': {
    law: 'UK PECR regulation 6, and Article 5(3) of the EU ePrivacy Directive',
    says: 'Non-essential cookies and similar tracking, such as analytics and advertising, need the visitor’s consent before they are set. The UK regulator says you cannot set them on your homepage before the visitor has agreed.',
    applies: 'If people in the UK or EU use your site.',
    url: 'https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/',
    verified: '2026-11-17',
  },
  'dpdp-notice': {
    law: 'India: Digital Personal Data Protection Act 2023 and Rules 2025',
    says: 'Anyone collecting personal data in India must give a notice in clear and plain language before asking for consent. The Rules setting out what that notice contains take effect in May 2027, 18 months after they were published in November 2025.',
    applies: 'If you collect personal data from people in India, or offer your app to them.',
    url: 'https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa',
    verified: '2026-11-17',
  },
  'ccpa-optout': {
    law: 'California Consumer Privacy Act',
    says: 'A business that sells or shares personal information, which includes passing it to advertising pixels, must show a clear link titled “Do Not Sell or Share My Personal Information”. The law only covers businesses above its size thresholds.',
    applies: 'Only if your business meets the CCPA thresholds and has California users.',
    url: 'https://oag.ca.gov/privacy/ccpa',
    verified: '2026-11-17',
  },
  'razorpay-pages': {
    law: 'Razorpay: website requirements for activation',
    says: 'Razorpay asks for links to your Contact us, Terms and conditions, Privacy policy and Cancellation and refunds pages when it reviews your website.',
    applies: 'If you take payments through Razorpay.',
    url: 'https://razorpay.com/docs/payments/dashboard/account-settings/business-website-details/',
    verified: '2026-11-17',
  },
};

export function source(id) {
  const r = RULES[id];
  if (!r) throw new Error(`Unknown rule ${id}`);
  return { id, law: r.law, says: r.says, applies: r.applies, url: r.url, verified: r.verified };
}

export function staleRules(today = new Date(), maxDays = 90) {
  return Object.entries(RULES)
    .filter(([, r]) => (today - new Date(r.verified)) / 864e5 > maxDays)
    .map(([id, r]) => ({ id, verified: r.verified, url: r.url }));
}
