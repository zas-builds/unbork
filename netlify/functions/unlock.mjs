// Where Razorpay sends the payer back to. Served at /api/unlock.
//
// Razorpay adds the payment details to this address as query parameters and
// signs them. We check the signature with our API secret before believing any
// of it, and only then is the report unlocked. A browser cannot unlock
// anything by visiting this address itself: without a signature made with a
// secret only Razorpay and our server hold, every visit is refused.
//
// Then the browser is sent back to the home page, which re-runs the check and
// this time receives the fixes.

import { paymentsConfig, paymentsReady, verifyLinkCallback } from '../../lib/payments.mjs';
import { openStore, grant } from '../../lib/unlocks.mjs';

export const config = {
  path: '/api/unlock',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

function back(origin, state) {
  return new Response(null, {
    status: 303,
    headers: { location: `${origin}/?paid=${state}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}

export default async function handler(request) {
  const origin = new URL(request.url).origin;
  const settings = paymentsConfig(process.env);
  if (!paymentsReady(settings)) return back(origin, 'off');

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const checked = verifyLinkCallback(params, settings.keySecret);
  // A payment that did not complete is not an error to shout about: the payer
  // knows what happened on Razorpay's page. We just do not unlock anything.
  if (!checked.ok) return back(origin, checked.why === 'not-paid' ? 'no' : 'bad');

  try {
    const store = await openStore();
    if (!store) return back(origin, 'late');
    await grant(store, checked.key, checked.ref);
  } catch {
    // The webhook is the other half of this and will grant it shortly, so the
    // payer is told to try the check again rather than told it failed.
    return back(origin, 'late');
  }
  return back(origin, 'yes');
}
