// Turning whatever a non-coder pastes into a URL we are willing to fetch.

const PRIVATE_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1', '0.0.0.0', 'metadata.google.internal',
]);

// Blocks requests to the machine running the scan and to private networks,
// so a pasted address cannot be used to probe things only the server can see.
export function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTS.has(h)) return true;
  if (h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^127\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
}

export function normaliseUrl(input, { allowLocal = false } = {}) {
  let raw = String(input || '').trim();
  if (!raw) return { error: 'Please paste your site address.' };
  raw = raw.replace(/^["'<]+|["'>]+$/g, '');
  // A scheme we will not fetch (javascript:, data:, file: and the like) is
  // refused by name, rather than being turned into a nonsense https address.
  // "myapp.com:3000/x" is a host and a port, not a scheme, so only a name
  // followed by "//" or by something other than digits counts as one.
  const scheme = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(raw);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    const looksLikePort = !scheme[2] && /^[0-9]/.test(raw.slice(scheme[0].length));
    if (!looksLikePort) {
      return { error: 'Only web addresses starting with http or https can be checked.' };
    }
  }
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw.replace(/^https?:\/*/i, '');

  let u;
  try { u = new URL(raw); } catch { return { error: "That does not look like a web address. It should look like myapp.lovable.app" }; }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { error: 'Only web addresses starting with http or https can be checked.' };
  }
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') {
    return { error: "That address is missing its ending, like .com or .app" };
  }
  if (!allowLocal && isPrivateHost(u.hostname)) {
    return { error: 'That address is only reachable from your own machine, so nobody outside can see it. Paste your live site address instead.' };
  }
  u.hash = '';
  return { url: u.toString(), parsed: u };
}
