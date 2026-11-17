// Fetching addresses that strangers paste in, without letting them use our
// server to reach places only it can see.
//
// Three layers, because each one alone has a known way round it:
// 1. The address is checked before anything is sent (url.mjs).
// 2. Every redirect is followed by hand and checked again, so a public page
//    cannot bounce us to 169.254.169.254 or to localhost.
// 3. The connection itself refuses private addresses at the moment the name is
//    turned into an IP, so a name that resolves to a private address, or that
//    changes its answer between our check and the request (DNS rebinding), is
//    still refused.

import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPrivateHost } from './url.mjs';

// True for any address that is not on the public internet.
export function isPrivateIp(ip) {
  let a = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4 written inside IPv6, e.g. ::ffff:127.0.0.1
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
    a = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  if (net.isIPv4(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 ||
      (p === 100 && q >= 64 && q <= 127) ||      // carrier-grade NAT
      (p === 169 && q === 254) ||                // link-local, cloud metadata
      (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) ||
      (p === 192 && q === 0) ||                  // IETF protocol assignments
      (p === 198 && (q === 18 || q === 19)) ||   // benchmarking
      p >= 224;                                  // multicast and reserved
  }
  if (net.isIPv6(a)) {
    return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) ||
      /^ff/.test(a) || /^64:ff9b:/.test(a) || /^2001:db8:/.test(a);
  }
  return true; // anything we cannot read is treated as private
}

// dns.lookup with every answer checked. Used by the connection itself.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    if (!list.length || list.some((x) => isPrivateIp(x.address))) {
      const e = new Error('private-address'); e.code = 'EPRIVATE';
      return callback(e);
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

const guardedAgent = new Agent({
  connect: { lookup: guardedLookup, timeout: 5000 },
});

// Only the normal web ports. A pasted address cannot be used to knock on
// other services running on someone's server.
export function allowedTarget(u, allowLocal) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (allowLocal) return true;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  if (isPrivateHost(u.hostname)) return false;
  const bare = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare) && isPrivateIp(bare)) return false;
  return true;
}

const MAX_HOPS = 5;

// Same shape as fetch(), with redirects followed by hand and checked each time.
// The Response it returns has .url set to the final address.
export async function safeFetch(url, init = {}, { allowLocal = false, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((u, i) => undiciFetch(u, allowLocal ? i : { ...i, dispatcher: guardedAgent }));
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!allowedTarget(current, allowLocal)) {
      const e = new Error('blocked-target'); e.code = 'EBLOCKED'; throw e;
    }
    const res = await doFetch(current.toString(), { ...init, redirect: 'manual' });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      try { await res.body?.cancel(); } catch { /* nothing to free */ }
      current = new URL(loc, current);
      continue;
    }
    // Responses built by hand (tests, mocks) may not carry their URL.
    try { Object.defineProperty(res, 'url', { value: current.toString(), configurable: true }); } catch { /* read-only is fine */ }
    return res;
  }
  const e = new Error('too-many-redirects'); e.code = 'EREDIRECTS'; throw e;
}
