// Copy to app/api/formosa/route.js (Next.js App Router, Node.js 22+).
// npm install cheerio tough-cookie
// Configure FORMOSA_CONFIG below. Optional ENV values override the code settings.
// Authorization: Bearer <FORMOSA_PROXY_TOKEN>
// No query: all countries, three countries at a time, until an empty page.
// ?country=6: all pages for China; ?country=6&page=1: just one page.
import { load } from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Server-side settings. Paste the Cookie request-header value from a logged-in Formosa session.
const FORMOSA_CONFIG = {
  proxyToken: 'a6184d11571c1ec0874d9086099ca2ede0820d4ff0a87850e1a355a9ffe3bf9e',
  cookie: 'wordpress_test_cookie=WP%20Cookie%20check; breeze_folder_name=d32cf666487fbc75b4d32e4b855a9bbff24514e1; wordpress_logged_in_2a83a54d58f34f172a794744fd383444=travelzeed%7C1792296400%7C27RLH5Bt8iqEFnU3gPNllF2sB16VBhKoWUyCb59UK6n%7Cd53d34c25c310b6ffc238739c0a9771f00f7022149d3200a9038fdc7a6001117', // Paste the real Formosa cookie here (without the "Cookie:" prefix).
};

const ORIGIN = 'https://formosajourneyland.co.th';
const MAX_PAGES = 50;
const COUNTRIES = ['6', '27', '28', '15', '7', '13', '25', '14', '10', '12', '219', '216', '229', '262'];
const NO_RESULTS = new Set(['', 'ไม่พบข้อมูล', 'ไม่พบโปรแกรมทัวร์ที่คุณค้นหา']);
const digits = (value) => value.replace(/[^0-9]/g, '');

class FormosaError extends Error {
  constructor(message, status = 502, diagnostics = {}) {
    super(message);
    this.status = status;
    this.diagnostics = diagnostics;
  }
}
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function parseTours(html, country, page) {
  const $ = load(html);
  const articles = $('article.tour-agent-loop-item');
  if (!articles.length) {
    const message = $('body').text().replace(/\s+/gu, ' ').trim();
    if (NO_RESULTS.has(message)) return [];
    throw new FormosaError('unexpected_tour_markup', 502, { country, page });
  }
  return articles.toArray().map((article) => {
    const tour = $(article);
    const text = (selector) => tour.find(selector).first().text().trim();
    const mainid = text('span.tour-no');
    if (!mainid) throw new FormosaError('tour_id_missing', 502, { country, page });
    const duration = text('div.tour-date-night').match(/(\d+)\s*วัน\s*(\d+)\s*คืน/u);
    const flights = [];
    for (const [selector, direction] of [['.tour-airline-start .air-row', 'depart'], ['.tour-airline-back .air-row', 'return']]) {
      tour.find(selector).each((_, row) => {
        const value = (s) => $(row).find(s).first().text().replace(/\s+/gu, ' ').trim();
        const [from_airport = '', to_airport = ''] = value('.airport-name').split('-').map((s) => s.trim());
        const [depart_time = '', arrive_time = ''] = value('.time').split('-').map((s) => s.trim());
        if (from_airport && to_airport && depart_time && arrive_time) {
          flights.push({ flight_direction: direction, from_airport, to_airport, flight_no: value('.flight'), depart_time, arrive_time });
        }
      });
    }
    const period = [];
    tour.find('table').first().find('tr').each((_, row) => {
      const cells = $(row).children('td');
      if (cells.length < 10) return;
      const cell = (i) => cells.eq(i).text().trim();
      const sale = cells.eq(2).find('span.tour-price-sale').first();
      const price_old = sale.length ? digits(sale.find('del span').first().text()) : '';
      const current = sale.length ? sale.clone() : cells.eq(2).clone();
      current.find('del').remove();
      const childPrice = (i) => {
        const content = cells.eq(i).clone();
        content.find('del').remove();
        return digits(content.text());
      };
      const commissions = cell(9).split('+');
      period.push({
        tour_period: cell(1), price: digits(current.text()), price_old,
        'Chd+B': childPrice(3), ChdNB: childPrice(4), single: digits(cell(5)),
        size: cell(6), Book: cell(7), AVBL: cell(8),
        comOffice: commissions[0].replace(/,/g, '').trim(),
        comSale: commissions[1] === undefined ? 0 : commissions[1].replace(/,/g, '').trim(),
      });
    });
    return {
      mainid, title: text('h3.entry-title'), banner: tour.find('figure.entry-image img').first().attr('src') || '',
      tour_day: Number(duration?.[1] || 0), tour_night: Number(duration?.[2] || 0),
      pdf: tour.find('a[id="pdf-file"]').first().attr('href') || '',
      doc: tour.find('a[id="word-file"]').first().attr('href') || '', flights, period,
    };
  });
}

export async function GET(request) {
  const secret = process.env.FORMOSA_PROXY_TOKEN ?? FORMOSA_CONFIG.proxyToken;
  const cookie = process.env.FORMOSA_COOKIE ?? FORMOSA_CONFIG.cookie;
  if (!secret || !cookie) return json({ ok: false, error: 'server_configuration_missing' }, 503);
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') || '');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return json({ ok: false, error: 'unauthorized' }, 401);
  const params = new URL(request.url).searchParams;
  const country = params.get('country') ?? (params.has('page') ? '6' : 'all');
  const pageValue = params.get('page');
  if ((country !== 'all' && !COUNTRIES.includes(country)) ||
      (pageValue !== null && (!/^[1-9]\d*$/.test(pageValue) || Number(pageValue) > MAX_PAGES)) || (country === 'all' && pageValue !== null)) {
    return json({ ok: false, error: 'invalid_country_or_page', countries: COUNTRIES, page_range: `1-${MAX_PAGES}` }, 400);
  }
  const jar = new CookieJar(); // Per request: do not share user sessions globally.
  const deadline = Date.now() + 50_000;
  const stop = new AbortController();
  try {
    for (const part of cookie.split(';')) {
      if (part.trim()) await jar.setCookie(`${part.trim()}; Path=/; Secure`, ORIGIN);
    }
    async function upstream(path, fields = null) {
      const stage = fields ? 'agent_ajax' : 'nonce_page';
      let diagnostics = { stage, ...(fields ? { country: fields.tour_tax_val, page: Number(fields.paged) } : {}) };
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new FormosaError('fetch_deadline_exceeded_use_country_or_page', 504, diagnostics);
      const url = `${ORIGIN}${path}`;
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timer = setTimeout(abort, Math.min(15_000, remaining));
      request.signal.addEventListener('abort', abort, { once: true });
      stop.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted || stop.signal.aborted) controller.abort();
      try {
        const response = await fetch(url, {
          method: fields ? 'POST' : 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
          headers: {
            'User-Agent': 'TravelzeedPartner/1.0 (+https://www.travelzeed.com)',
            Accept: 'application/json, text/html', Cookie: await jar.getCookieString(url),
            ...(fields ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          ...(fields ? { body: new URLSearchParams(fields).toString() } : {}),
        });
        for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, url);
        const ray = response.headers.get('cf-ray') || '';
        diagnostics = { ...diagnostics, http_status: response.status, cf_ray: /^[a-f0-9]{8,32}-[a-z]{3}$/i.test(ray) ? ray : null };
        const body = await response.text();
        if (response.headers.get('cf-mitigated') === 'challenge' || /cf-chl-|\/cdn-cgi\/challenge-platform|<title>\s*(Just a moment|Attention Required)/i.test(body)) {
          throw new FormosaError('upstream_challenge', 502, diagnostics);
        }
        if (response.status === 401 || /<input\b[^>]*\bname\s*=\s*['"]pwd['"]/i.test(body)) {
          throw new FormosaError('session_expired_update_FORMOSA_COOKIE', 502, diagnostics);
        }
        if (response.status >= 300 && response.status < 400) throw new FormosaError('upstream_redirect_check_session', 502, diagnostics);
        return { status: response.status, body, diagnostics };
      } catch (error) {
        if (error instanceof FormosaError) throw error;
        throw new FormosaError(controller.signal.aborted ? 'upstream_timeout_or_cancelled' : 'upstream_connection_failed', controller.signal.aborted ? 504 : 502, diagnostics);
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
        stop.signal.removeEventListener('abort', abort);
      }
    }
    async function getNonce() {
      const response = await upstream('/agent-tour-category/?tour_country=6');
      const { diagnostics } = response;
      if (response.status !== 200) throw new FormosaError('nonce_page_http_' + response.status, 502, diagnostics);
      const match = response.body.match(/\b(?:var|let|const)\s+agent_ajax_object\s*=\s*(\{[^;]+\})\s*;/);
      let config;
      try { config = JSON.parse(match?.[1] || 'null'); } catch { /* Safe error below. */ }
      if (typeof config?.nonce !== 'string' || !config.nonce) throw new FormosaError('agent_nonce_missing_check_session', 502, diagnostics);
      return config.nonce;
    }
    let nonce = await getNonce();
    let nonceRefresh;
    async function getPage(countryId, page) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const sentNonce = nonce;
        const response = await upstream('/wp-admin/admin-ajax.php', {
          action: 'tour_callback_agent_country', nonce: sentNonce, tour_keyword: '', tour_city: '', tour_month: '',
          tour_tax: 'tour-country', tour_tax_val: countryId, tour_cat: '', tour_sort: '', paged: String(page),
        });
        const { diagnostics } = response;
        if ([200, 403].includes(response.status) && response.body.trim() === '-1') {
          if (attempt === 0) {
            if (nonce === sentNonce) {
              nonceRefresh ??= getNonce().then((value) => { nonce = value; }).finally(() => { nonceRefresh = undefined; });
              await nonceRefresh;
            }
            continue;
          }
          throw new FormosaError('agent_nonce_rejected_after_refresh', 502, diagnostics);
        }
        if (response.status !== 200) throw new FormosaError('agent_ajax_http_' + response.status, 502, diagnostics);
        let data;
        try { data = JSON.parse(response.body); } catch { /* Safe error below. */ }
        if (typeof data?.result !== 'string') throw new FormosaError('agent_ajax_invalid_response_check_session', 502, diagnostics);
        return parseTours(data.result, countryId, page);
      }
    }
    const countries = country === 'all' ? COUNTRIES : [country];
    const results = new Map();
    let nextCountry = 0;
    async function collectCountry(countryId) {
      const tours = [];
      const firstPage = pageValue === null ? 1 : Number(pageValue);
      const lastPage = pageValue === null ? MAX_PAGES : firstPage;
      for (let page = firstPage; page <= lastPage; page++) {
        const batch = await getPage(countryId, page);
        if (!batch.length) break;
        tours.push(...batch);
        if (pageValue === null && page === MAX_PAGES) {
          throw new FormosaError('pagination_limit_exceeded_use_page', 502, { country: countryId, page });
        }
      }
      results.set(countryId, tours);
    }
    async function worker() {
      while (!stop.signal.aborted && nextCountry < countries.length) {
        const countryId = countries[nextCountry++];
        await collectCountry(countryId);
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, countries.length) }, () => worker()));
    const tours = new Map();
    for (const countryId of countries) {
      for (const tour of results.get(countryId)) if (!tours.has(tour.mainid)) tours.set(tour.mainid, tour);
    }
    return json([...tours.values()]);
  } catch (error) {
    stop.abort();
    // Never return partial tour data, upstream HTML, cookies or nonce values on failure.
    return json({
      ok: false, statusCode: error instanceof FormosaError ? error.status : 502,
      error: error instanceof FormosaError ? error.message : 'formosa_fetch_failed',
      diagnostics: error instanceof FormosaError ? error.diagnostics : {},
    }, error instanceof FormosaError ? error.status : 502);
  }
}
