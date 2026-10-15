import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormosaHandler, COUNTRIES, parseTours } from '../lib/formosa.js';
import { runtime, dynamic, revalidate, fetchCache, maxDuration } from '../app/api/formosa/route.js';
import { article, noncePage, ajaxPage } from './fixtures/formosa.js';

const env = { FORMOSA_PROXY_TOKEN: 'fixture-token', FORMOSA_COOKIE: 'session=fixture-cookie' };
const request = (query = '', authorization = `Bearer ${env.FORMOSA_PROXY_TOKEN}`, signal) => new Request(
  `http://localhost/api/formosa${query}`, { headers: authorization === null ? {} : { authorization }, signal },
);
const handler = (fetchImpl, options = {}) => createFormosaHandler({ env, fetchImpl, ...options });
const cached = (response) => {
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('vary'), 'Authorization');
};
const safeError = async (response, code, stage, httpStatus) => {
  assert.equal(response.status, 502);
  cached(response);
  const data = await response.json();
  assert.equal(data.statusCode, 502);
  if (code) assert.equal(data.error, code);
  if (stage) assert.equal(data.diagnostics.stage, stage);
  if (httpStatus) assert.equal(data.diagnostics.http_status, httpStatus);
  assert.ok(!Array.isArray(data));
  assert.ok(!('data' in data));
  assert.ok(Object.keys(data.diagnostics).every((key) => ['stage', 'http_status', 'cf_ray'].includes(key)));
  const text = JSON.stringify(data);
  for (const secret of ['fixture-token', 'fixture-cookie', 'fixture-nonce', '<html', '<script', 'private-error-detail']) {
    assert.ok(!text.includes(secret), `response leaked ${secret}`);
  }
  return data;
};

test('route uses Node runtime and disables Next.js caching', () => {
  assert.equal(runtime, 'nodejs');
  assert.equal(dynamic, 'force-dynamic');
  assert.equal(revalidate, 0);
  assert.equal(fetchCache, 'force-no-store');
  assert.equal(maxDuration, 60);
});

test('configuration, auth and query validation occur without upstream calls', async () => {
  let calls = 0;
  const noFetch = async () => { calls++; throw new Error('must not call'); };
  const get = handler(noFetch);
  for (const token of [null, 'Bearer wrong', 'Basic fixture-token', 'Bearer tiny', `Bearer ${'x'.repeat(500)}`, 'Bearer \u00ff']) {
    const response = await get(request('?country=bad', token));
    assert.equal(response.status, 401);
    cached(response);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  }
  for (const query of [
    '?country=', '?country=999', '?country=Japan', '?country=all', '?country=07', '?page=1',
    '?country=7&page=0', '?country=7&page=-1', '?country=7&page=01', '?country=7&page=1.5',
    '?country=7&page=', '?country=7&page=201', '?country=7&page=1e2', '?country=7&page=9007199254740992',
    '?country=7&page=1&page=2', '?country=7&country=6', '?country=7&url=https://example.test',
  ]) {
    const response = await get(request(query));
    assert.equal(response.status, 400, query);
    cached(response);
  }
  for (const config of [{}, { FORMOSA_PROXY_TOKEN: '' }, { FORMOSA_PROXY_TOKEN: 'bad token' },
    { ...env, FORMOSA_COOKIE: '' }, { ...env, FORMOSA_COOKIE: 'session=bad\r\nHeader: x' }]) {
    assert.equal((await handler(noFetch, { env: config })(request())).status, 503);
  }
  // A cookie configuration failure must not bypass authentication.
  assert.equal((await handler(noFetch, { env: { ...env, FORMOSA_COOKIE: '' } })(request('', null))).status, 401);
  assert.equal(calls, 0);
});

test('parses Thai, emoji, both durations, first table, all flights and separate prices', () => {
  const [tour] = parseTours(article());
  assert.deepEqual(tour, {
    mainid: 'JP-001', title: 'ญี่ปุ่น หิมะ ❄️ เที่ยวสนุก 🗾', banner: 'https://example.test/banner.jpg',
    tour_day: 6, tour_night: 5, pdf: 'https://example.test/tour.pdf', doc: 'https://example.test/tour.doc',
    flights: [
      { flight_direction: 'depart', from_airport: 'BKK', to_airport: 'KIX', flight_no: 'TG 622', depart_time: '08:00', arrive_time: '16:00' },
      { flight_direction: 'depart', from_airport: 'KIX', to_airport: 'HND', flight_no: 'JL 12', depart_time: '17:00', arrive_time: '18:00' },
      { flight_direction: 'return', from_airport: 'HND', to_airport: 'BKK', flight_no: 'TG 623', depart_time: '19:00', arrive_time: '23:00' },
    ],
    period: [
      { tour_period: '1–6 มกราคม 2570 🎉', price: '25900', price_old: '29900', 'Chd+B': '22900', ChdNB: '18900',
        single: '3000', size: '30', Book: '10', AVBL: '20 ที่ / รอคอนเฟิร์ม ✅', comOffice: '1000', comSale: '500' },
      { tour_period: '7–12 มกราคม 2570', price: '31900', price_old: '', 'Chd+B': '28900', ChdNB: '25900',
        single: '4000', size: '25', Book: '5', AVBL: 'เต็ม', comOffice: '1500', comSale: '600' },
    ],
  });
  const [short] = parseTours(article('JP-002', 'ระยะเวลา 5D3N'));
  assert.equal(short.tour_day, 5);
  assert.equal(short.tour_night, 3);
  assert.deepEqual(parseTours(''), []);
  for (const message of ['ไม่พบข้อมูล', 'ไม่พบโปรแกรมทัวร์ที่คุณค้นหา']) {
    assert.deepEqual(parseTours(`<div> ${message} </div>`), []);
    assert.equal(parseTours(`${message}${article()}`).length, 1);
  }
  assert.throws(() => parseTours('<div>unrecognized empty state</div>'), /unexpected_tour_markup/);
  assert.throws(() => parseTours(article().replace('JP-001', '')), /upstream_tour_id_missing/);
});

test('exact country mapping, POST form encoding and explicit page beyond six', async () => {
  assert.deepEqual(COUNTRIES, {
    china: '6', 'America & Cannada': '27', Europe: '28', Georgia: '15', Japan: '7', Myanmar: '13', Russia: '25',
    Singapore: '14', Taiwan: '10', Vietnam: '12', Macao: '219', 'Hong-long': '216', Kazakhstan: '229', Egypt: '262',
  });
  let calls = 0;
  const get = handler(async (url, options) => {
    calls++;
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Cookie, 'session=fixture-cookie');
    if (options.method === 'GET') {
      assert.equal(url, 'https://formosajourneyland.co.th/agent-tour-category/');
      return noncePage();
    }
    assert.equal(url, 'https://formosajourneyland.co.th/wp-admin/admin-ajax.php');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
    assert.ok(options.body instanceof URLSearchParams);
    assert.deepEqual(Object.fromEntries(options.body), {
      action: 'tour_callback_agent_country', nonce: 'fixture-nonce-1', tour_keyword: '',
      tour_tax: 'tour-country', tour_tax_val: '7', tour_cat: '', paged: '7',
    });
    return ajaxPage(article(), '<a>next</a>');
  });
  const response = await get(request('?country=7&page=7'));
  assert.equal(response.status, 200);
  cached(response);
  assert.equal((await response.json())[0].mainid, 'JP-001');
  assert.equal(calls, 2);
});

test('all countries are fetched, starting at paged=1; shared IDs deduplicated', async () => {
  const seen = [];
  const get = handler(async (_, options) => {
    if (!options.body) return noncePage();
    seen.push(options.body.get('tour_tax_val'));
    assert.equal(options.body.get('paged'), '1');
    return ajaxPage(article('shared') + article(`C-${options.body.get('tour_tax_val')}`));
  });
  const response = await get(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).length, 15);
  assert.deepEqual(seen, Object.values(COUNTRIES));
});

test('pagination passes six pages and entirely duplicated pages do not stop collection', async () => {
  const seen = [];
  const get = handler(async (_, options) => {
    if (!options.body) return noncePage();
    const n = Number(options.body.get('paged'));
    seen.push(n);
    return ajaxPage(article(n < 7 ? 'duplicate' : 'new-on-page-7'), n === 8 ? '' : '<a>next</a>');
  });
  const response = await get(request('?country=7'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((tour) => tour.mainid), ['duplicate', 'new-on-page-7']);
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('empty result and Thai empty states stop even with nonempty pagination', async () => {
  for (const empty of ['', 'ไม่พบข้อมูล', '<p>ไม่พบโปรแกรมทัวร์ที่คุณค้นหา</p>']) {
    let calls = 0;
    const get = handler(async (_, options) => {
      if (!options.body) return noncePage();
      calls++;
      return ajaxPage(empty, '<a>next</a>');
    });
    const response = await get(request('?country=7'));
    assert.deepEqual(await response.json(), []);
    assert.equal(calls, 1);
  }
});

test('safety limit is an error rather than a truncated success', async () => {
  const pages = [];
  const get = handler(async (_, options) => {
    if (!options.body) return noncePage();
    pages.push(options.body.get('paged'));
    return ajaxPage(article(), 'next');
  }, { limits: { maxPages: 3 } });
  await safeError(await get(request('?country=7')), 'pagination_limit_exceeded_use_page', 'ajax', 200);
  assert.deepEqual(pages, ['1', '2', '3']);
});

test('200/403 -1 refreshes nonce once and uses cookies rotated by GET and POST', async () => {
  for (const rejectedStatus of [200, 403]) {
    let nonceCalls = 0, posts = 0;
    const get = handler(async (_, options) => {
      if (!options.body) {
        nonceCalls++;
        if (nonceCalls === 2) assert.match(options.headers.Cookie, /session=post-rotation/);
        return noncePage(`fixture-nonce-${nonceCalls}`, { 'Set-Cookie': `session=get-rotation-${nonceCalls}; Path=/; Secure; HttpOnly` });
      }
      posts++;
      assert.match(options.headers.Cookie, new RegExp(`session=get-rotation-${nonceCalls}`));
      assert.equal(options.body.get('nonce'), `fixture-nonce-${nonceCalls}`);
      assert.equal(options.body.get('paged'), '1');
      if (posts === 1) return new Response(' -1\n', { status: rejectedStatus,
        headers: { 'Set-Cookie': 'session=post-rotation; Path=/; Secure' } });
      return ajaxPage(article());
    });
    assert.equal((await get(request('?country=7&page=1'))).status, 200);
    assert.equal(nonceCalls, 2);
    assert.equal(posts, 2);
  }
});

test('repeated nonce rejection stops at two POST attempts', async () => {
  let nonceCalls = 0, posts = 0;
  const get = handler(async (_, options) => {
    if (!options.body) { nonceCalls++; return noncePage(); }
    posts++;
    return new Response('-1', { status: 403 });
  });
  await safeError(await get(request('?country=7')), 'upstream_nonce_rejected', 'ajax', 403);
  assert.equal(nonceCalls, 2);
  assert.equal(posts, 2);
});

test('nonce refresh allowance is per page; new nonce is reused on subsequent pages', async () => {
  let nonceCalls = 0;
  const seen = [];
  const get = handler(async (_, options) => {
    if (!options.body) return noncePage(`fixture-nonce-${++nonceCalls}`);
    const n = Number(options.body.get('paged'));
    seen.push([n, options.body.get('nonce')]);
    if (nonceCalls === n) return new Response('-1');
    return ajaxPage(article(`page-${n}`), n === 2 ? '' : 'next');
  });
  assert.equal((await get(request('?country=7'))).status, 200);
  assert.equal(nonceCalls, 3);
  assert.deepEqual(seen, [[1, 'fixture-nonce-1'], [1, 'fixture-nonce-2'], [2, 'fixture-nonce-2'], [2, 'fixture-nonce-3']]);
});

test('upstream 403/429/5xx at either stage are 502 without automatic retry or secret leaks', async () => {
  for (const stage of ['nonce', 'ajax']) for (const status of [403, 429, 500, 502, 503]) {
    let calls = 0;
    const get = handler(async (_, options) => {
      calls++;
      if (stage === 'ajax' && !options.body) return noncePage();
      return new Response('<html>private-error-detail fixture-cookie fixture-token fixture-nonce</html>', {
        status, headers: { 'cf-ray': '0123456789abcdef-BKK' },
      });
    });
    const data = await safeError(await get(request('?country=7')), 'upstream_http_error', stage, status);
    assert.equal(data.diagnostics.cf_ray, '0123456789abcdef-BKK');
    assert.equal(calls, stage === 'nonce' ? 1 : 2);
  }
});

test('failure on later page or later country never returns partial success', async () => {
  for (const query of ['?country=7', '']) {
    let posts = 0;
    const get = handler(async (_, options) => {
      if (!options.body) return noncePage();
      if (++posts === 2) return new Response('private-error-detail', { status: 503 });
      return ajaxPage(article('already-collected'), query ? 'next' : '');
    });
    const response = await get(request(query));
    const data = await safeError(response, 'upstream_http_error', 'ajax', 503);
    assert.ok(!JSON.stringify(data).includes('already-collected'));
  }
});

test('malformed nonce, AJAX JSON, pagination and tour markup are sanitized errors', async () => {
  for (const body of ['private-error-detail', '<script>var unrelated={nonce:"fixture-nonce"}</script>',
    '<script>var agent_ajax_object={nonce: alert("fixture-nonce")}</script>']) {
    await safeError(await handler(async () => new Response(body))(request()), 'upstream_nonce_missing_check_session', 'nonce', 200);
  }
  for (const body of ['<html>private-error-detail</html>', '-1x', 'null', '[]', '{"result":""}',
    '{"result":"","pagination":null}', JSON.stringify({ result: '<div>private-error-detail</div>', pagination: '' })]) {
    const get = handler(async (_, options) => options.body ? new Response(body) : noncePage());
    await safeError(await get(request('?country=7&page=1')), null, 'ajax', 200);
  }
});

test('invalid cf-ray values are omitted', async () => {
  for (const ray of ['fixture-token', '<script>', '0123456789abcdef-BKK extra', '0123456789abcdef-BKK\u00ff']) {
    const response = await handler(async () => new Response('private-error-detail', { status: 403, headers: { 'cf-ray': ray } }))(request());
    const data = await safeError(response);
    assert.ok(!('cf_ray' in data.diagnostics));
  }
});

test('redirects cannot leave the exact HTTPS origin or include credentials', async () => {
  for (const location of ['https://evil.test/', 'http://formosajourneyland.co.th/',
    'https://formosajourneyland.co.th:444/', 'https://user:pass@formosajourneyland.co.th/', '//evil.test/', 'file:///etc/passwd']) {
    let calls = 0;
    const get = handler(async () => { calls++; return new Response(null, { status: 302, headers: { location } }); });
    await safeError(await get(request()), 'upstream_redirect_forbidden', 'nonce', 302);
    assert.equal(calls, 1);
  }
});

test('same-origin redirects retain session cookies and enforce a finite hop limit', async () => {
  let calls = 0;
  const get = handler(async (url, options) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 302, headers: {
      location: '/agent-tour-category/?redirected=1', 'Set-Cookie': 'session=redirect-rotation; Path=/; Secure',
    } });
    assert.match(options.headers.Cookie, /session=redirect-rotation/);
    if (!options.body) { assert.match(url, /redirected=1$/); return noncePage(); }
    return ajaxPage();
  });
  assert.equal((await get(request('?country=7'))).status, 200);
  calls = 0;
  const looping = handler(async () => { calls++; return new Response(null, { status: 302, headers: { location: '/loop' } }); }, { limits: { redirects: 2 } });
  await safeError(await looping(request()), 'upstream_redirect_limit', 'nonce', 302);
  assert.equal(calls, 3);
});

test('POST redirects only preserve the method with 307/308', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let posts = 0;
    const get = handler(async (_, options) => {
      if (!options.body) return noncePage();
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('tour_tax_val'), '7');
      if (++posts === 1) return new Response(null, { status, headers: { location: '/wp-admin/admin-ajax.php?moved=1' } });
      return ajaxPage();
    });
    const response = await get(request('?country=7'));
    if ([307, 308].includes(status)) { assert.equal(response.status, 200); assert.equal(posts, 2); }
    else { await safeError(response, 'upstream_post_redirect_rejected', 'ajax', status); assert.equal(posts, 1); }
  }
});

test('network errors, request timeout, body timeout, total deadline and client cancellation return 502', async () => {
  await safeError(await handler(async () => { throw new Error('fixture-cookie private-error-detail'); })(request()), 'upstream_connection_failed', 'nonce');
  const blocked = async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('private-error-detail')), { once: true });
  });
  await safeError(await handler(blocked, { limits: { requestMs: 5 } })(request()), 'upstream_timeout_or_cancelled', 'nonce');
  const bodyBlocked = async (_, options) => ({
    status: 200, headers: new Headers(), text: () => blocked(_, options),
  });
  await safeError(await handler(bodyBlocked, { limits: { requestMs: 5 } })(request()), 'upstream_timeout_or_cancelled', 'nonce', 200);
  let calls = 0;
  await safeError(await handler(async () => { calls++; return noncePage(); }, { limits: { totalMs: 0 } })(request()), 'upstream_deadline_exceeded', 'nonce');
  assert.equal(calls, 0);
  const controller = new AbortController();
  controller.abort();
  await safeError(await handler(async () => { calls++; })(request('', undefined, controller.signal)), 'upstream_cancelled', 'nonce');
  assert.equal(calls, 0);
  const activeController = new AbortController();
  const pending = handler(blocked)(request('', undefined, activeController.signal));
  setTimeout(() => activeController.abort(), 5);
  await safeError(await pending, 'upstream_timeout_or_cancelled', 'nonce');
});

test('cookie jars are isolated across inbound requests', async () => {
  let seenSeed = 0;
  const get = handler(async (_, options) => {
    if (!options.body) {
      assert.equal(options.headers.Cookie, 'session=fixture-cookie');
      seenSeed++;
      return noncePage('fixture-nonce', { 'Set-Cookie': 'session=rotated; Path=/; Secure' });
    }
    assert.equal(options.headers.Cookie, 'session=rotated');
    return ajaxPage();
  });
  await get(request('?country=7'));
  await get(request('?country=7'));
  assert.equal(seenSeed, 2);
});

test('multiple Set-Cookie headers, deletion, path scoping and post-page rotation reach the next page', async () => {
  const get = handler(async (_, options) => {
    if (!options.body) {
      const headers = new Headers();
      headers.append('Set-Cookie', 'session=rotated; Path=/; Secure; HttpOnly');
      headers.append('Set-Cookie', 'ajax-only=value; Path=/wp-admin; Secure; Expires=Wed, 21 Oct 2037 07:28:00 GMT');
      return noncePage('fixture-nonce', headers);
    }
    if (options.body.get('paged') === '1') {
      assert.match(options.headers.Cookie, /session=rotated/);
      assert.match(options.headers.Cookie, /ajax-only=value/);
      const response = ajaxPage(article(), 'next');
      response.headers.append('Set-Cookie', 'session=page-rotation; Path=/; Secure');
      response.headers.append('Set-Cookie', 'ajax-only=; Max-Age=0; Path=/wp-admin; Secure');
      return response;
    }
    assert.equal(options.headers.Cookie, 'session=page-rotation');
    return ajaxPage();
  });
  assert.equal((await get(request('?country=7'))).status, 200);
});

test('nonce refresh failure stops immediately without retrying the page again', async () => {
  let gets = 0, posts = 0;
  const get = handler(async (_, options) => {
    if (!options.body) return ++gets === 1 ? noncePage() : new Response('private-error-detail', { status: 403 });
    posts++;
    return new Response('-1');
  });
  await safeError(await get(request('?country=7')), 'upstream_http_error', 'nonce', 403);
  assert.equal(gets, 2);
  assert.equal(posts, 1);
});
