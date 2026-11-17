import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, allowedTarget, safeFetch } from '../lib/safeFetch.mjs';
import { fetchSite } from '../lib/fetchSite.mjs';

test('private and reserved addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '224.0.0.1'])
    assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '104.198.14.52', '2606:4700::1111'])
    assert.equal(isPrivateIp(ip), false, ip);
});

test('odd ports, passwords in the address and raw private IPs are refused', () => {
  assert.equal(allowedTarget(new URL('https://example.com:8443/'), false), false);
  assert.equal(allowedTarget(new URL('https://user:pw@example.com/'), false), false);
  assert.equal(allowedTarget(new URL('http://2130706433/'), false), false, 'decimal form of 127.0.0.1');
  assert.equal(allowedTarget(new URL('http://[::ffff:7f00:1]/'), false), false);
  assert.equal(allowedTarget(new URL('https://example.com/'), false), true);
});

test('a public page that redirects to the cloud metadata address is not followed', async () => {
  const calls = [];
  const fetchImpl = async (u) => {
    calls.push(u);
    return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
  };
  await assert.rejects(safeFetch('https://example.com/', {}, { fetchImpl }), (e) => e.code === 'EBLOCKED');
  assert.deepEqual(calls, ['https://example.com/'], 'the private address is never requested');

  const r = await fetchSite('https://example.com/', { fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.error, /somewhere private/);
});

test('redirect loops stop after five hops', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return new Response('', { status: 301, headers: { location: `https://example.com/${n}` } }); };
  await assert.rejects(safeFetch('https://example.com/', {}, { fetchImpl }), (e) => e.code === 'EREDIRECTS');
  assert.equal(n, 6);
});
