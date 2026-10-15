import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}/api/formosa`;
const server = spawn(process.execPath, [
  '--import', './tests/formosa-upstream-preload.js',
  './node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port),
], {
  cwd: process.cwd(), windowsHide: true, stdio: 'ignore',
  env: { ...process.env, NODE_OPTIONS: '', FORMOSA_COOKIE: 'session=fixture-cookie', FORMOSA_PROXY_TOKEN: 'fixture-token' },
});
let startupError;
server.on('error', (error) => { startupError = error; });
const headers = { authorization: 'Bearer fixture-token' };
let checks = 0;
function check(condition) { assert.ok(condition); checks++; }

try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (startupError || server.exitCode !== null) throw new Error('Local Next.js failed to start');
    try { await fetch(base, { signal: AbortSignal.timeout(500) }); ready = true; break; } catch {}
    await delay(100);
  }
  check(ready);
  for (const options of [{}, { headers: { authorization: 'Bearer wrong' } }]) {
    const response = await fetch(base, options);
    check(response.status === 401);
    check((await response.json()).error === 'unauthorized');
    check(response.headers.get('cache-control').includes('no-store'));
  }
  for (const query of ['?country=bad', '?page=1', '?country=7&page=0']) {
    check((await fetch(base + query, { headers })).status === 400);
  }
  const first = await fetch(base + '?country=7&page=1', { headers });
  check(first.status === 200);
  check(first.headers.get('cache-control').includes('no-store'));
  check(first.headers.get('vary').toLowerCase().includes('authorization'));
  const tours = await first.json();
  check(Array.isArray(tours) && tours.length === 1);
  check(tours[0].title === 'ญี่ปุ่น หิมะ ❄️ เที่ยวสนุก 🗾');
  check(tours[0].period[0].price === '25900' && tours[0].period[0].price_old === '29900');
  check(tours[0].tour_day === 6 && tours[0].tour_night === 5);
  const full = await fetch(base + '?country=7', { headers });
  check(full.status === 200);
  const allPages = await full.json();
  check(allPages.length === 2 && allPages[1].mainid === 'new-on-page-7');
  for (const query of ['?country=6', '', '?country=14&page=1']) {
    const response = await fetch(base + query, { headers });
    check(response.status === 502);
    const error = await response.json();
    check(error.statusCode === 502 && !Array.isArray(error) && !('data' in error));
    const serialized = JSON.stringify(error);
    check(!/private-error-detail|fixture-cookie|fixture-token|fixture-nonce|duplicate/.test(serialized));
  }
  // An authenticated success must not become an anonymous cached response.
  check((await fetch(base + '?country=7&page=1')).status === 401);
  if (process.argv.includes('--postman')) {
    const script = [
      "pm.test('HTTP 200', () => pm.response.to.have.status(200));",
      "pm.test('Array schema', () => pm.expect(pm.response.json()).to.be.an('array'));",
      "pm.test('Thai and emoji', () => pm.expect(pm.response.json()[0].title).to.equal('ญี่ปุ่น หิมะ ❄️ เที่ยวสนุก 🗾'));",
      "pm.test('No cache', () => pm.expect(pm.response.headers.get('Cache-Control')).to.include('no-store'));",
    ].join('\n');
    const result = await promisify(execFile)('postman', [
      'request', `${base}?country=7&page=1`, '--header', 'Authorization:Bearer fixture-token',
      '--no-report-events', '--timeout', '10000', '--script-post-request', script,
    ], { windowsHide: true, timeout: 30000, encoding: 'utf8' });
    check(!result.stderr.includes('Error'));
    console.log('Postman CLI: 4 local HTTP assertions passed; exit code 0; event reporting disabled');
  }
  console.log(`Local Next.js HTTP checks passed: ${checks} (synthetic upstream; no live Formosa calls)`);
} finally {
  server.kill();
}
