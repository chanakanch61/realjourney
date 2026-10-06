import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/formosa/route.js';

const article = (id) => `<article class="tour-agent-loop-item">
  <span class="tour-no">${id}</span><h3 class="entry-title">ทัวร์จีน</h3>
  <div class="tour-date-night">5 วัน 4 คืน</div>
  <table><tr><td>1</td><td>1-5 มกราคม</td>
  <td><span class="tour-price-sale"><del><span>20,000</span></del>18,000</span></td>
  <td>15,000</td><td>12,000</td><td>3,000</td><td>30</td><td>10</td><td>20</td><td>1,000+500</td>
  </tr></table></article>`;
const noncePage = (nonce = 'nonce-1') => new Response(`var agent_ajax_object = {"nonce":"${nonce}"};`);
const page = (html) => Response.json({ result: html });
const request = (query = '') => new Request(`http://localhost/api/formosa${query}`, {
  headers: { authorization: 'Bearer test-token' },
});

test('Formosa route with real parser and cookie jar, mocked upstream', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const key of ['FORMOSA_PROXY_TOKEN', 'FORMOSA_COOKIE']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });
  await t.test('configuration, authentication and invalid query guards', async () => {
    delete process.env.FORMOSA_PROXY_TOKEN;
    assert.equal((await GET(request())).status, 503);
    process.env.FORMOSA_PROXY_TOKEN = 'test-token';
    process.env.FORMOSA_COOKIE = 'session=test';
    assert.equal((await GET(new Request('http://localhost/api/formosa'))).status, 401);
    for (const query of ['?country=999', '?page=0', '?page=51', '?page=01', '?country=all&page=1']) {
      assert.equal((await GET(request(query))).status, 400);
    }
  });
  await t.test('parses Thai duration and discounted prices; single page beyond six', async () => {
    globalThis.fetch = async (url, options) => {
      assert.match(options.headers.Cookie, /session=test/);
      if (!options.body) return noncePage();
      assert.equal(new URLSearchParams(options.body).get('paged'), '7');
      return page(article('T7'));
    };
    const response = await GET(request('?country=6&page=7'));
    assert.equal(response.status, 200);
    const [tour] = await response.json();
    assert.equal(tour.tour_day, 5);
    assert.equal(tour.tour_night, 4);
    assert.equal(tour.period[0].price, '18000');
    assert.equal(tour.period[0].price_old, '20000');
  });
  await t.test('continues beyond page six and stops at empty page', async () => {
    const pages = [];
    globalThis.fetch = async (url, options) => {
      if (!options.body) return noncePage();
      const n = Number(new URLSearchParams(options.body).get('paged'));
      pages.push(n);
      return page(n < 8 ? article(`T${n}`) : 'ไม่พบข้อมูล');
    };
    const response = await GET(request('?country=6'));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 7);
    assert.equal(pages.at(-1), 8);
  });
  await t.test('all-country concurrency is bounded; nonce refresh is shared', async () => {
    let active = 0, peak = 0, nonceCalls = 0;
    const seen = new Set();
    globalThis.fetch = async (url, options) => {
      if (!options.body) { nonceCalls++; return noncePage(`nonce-${nonceCalls}`); }
      const fields = new URLSearchParams(options.body);
      seen.add(fields.get('tour_tax_val'));
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (fields.get('nonce') === 'nonce-1') return new Response('-1', { status: 403 });
      return page(fields.get('paged') === '1' ? article('shared-tour') : '');
    };
    const response = await GET(request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 1);
    assert.equal(seen.size, 14);
    assert.equal(peak, 3);
    assert.equal(nonceCalls, 2);
  });
  await t.test('pagination limit fails instead of returning truncated success', async () => {
    globalThis.fetch = async (url, options) => options.body ? page(article('T1')) : noncePage();
    const response = await GET(request('?country=6'));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'pagination_limit_exceeded_use_page');
  });
  await t.test('client cancellation returns 504', async () => {
    globalThis.fetch = async (url, options) => {
      options.signal.throwIfAborted();
      throw new Error('Expected an aborted signal');
    };
    const controller = new AbortController();
    controller.abort();
    const response = await GET(new Request(request('?country=6'), { signal: controller.signal }));
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error, 'upstream_timeout_or_cancelled');
  });
  await t.test('one failed country cancels the other in-flight requests', async () => {
    let cancelled = 0;
    globalThis.fetch = async (url, options) => {
      if (!options.body) return noncePage();
      if (new URLSearchParams(options.body).get('tour_tax_val') === '6') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response('upstream failed', { status: 500 });
      }
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          cancelled++;
          reject(options.signal.reason);
        }, { once: true });
      });
    };
    const response = await GET(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'agent_ajax_http_500');
    assert.equal(cancelled, 2);
  });
  await t.test('upstream failures are sanitized and retain request diagnostics', async () => {
    for (const [body, expected] of [
      ['<title>Just a moment</title>', 'upstream_challenge'],
      ['<input name="pwd">', 'session_expired_update_FORMOSA_COOKIE'],
      ['invalid-json', 'agent_ajax_invalid_response_check_session'],
      [JSON.stringify({ result: '<div>unexpected markup</div>' }), 'unexpected_tour_markup'],
    ]) {
      globalThis.fetch = async (url, options) => options.body ? new Response(body) : noncePage();
      const response = await GET(request('?country=6&page=1'));
      assert.equal(response.status, 502);
      const data = await response.json();
      assert.equal(data.error, expected);
      assert.equal(data.diagnostics.country, '6');
      assert.equal(data.diagnostics.page, 1);
      assert.ok(!JSON.stringify(data).includes('session=test'));
    }
  });
});
