import { createHash, timingSafeEqual } from 'node:crypto';
import { load } from 'cheerio';
import { CookieJar } from 'tough-cookie';

const ORIGIN = 'https://formosajourneyland.co.th';
export const COUNTRIES = Object.freeze({
  china: '6', 'America & Cannada': '27', Europe: '28', Georgia: '15',
  Japan: '7', Myanmar: '13', Russia: '25', Singapore: '14', Taiwan: '10',
  Vietnam: '12', Macao: '219', 'Hong-long': '216', Kazakhstan: '229', Egypt: '262',
});
const COUNTRY_IDS = Object.values(COUNTRIES);
const DEFAULT_LIMITS = { maxPages: 200, requestMs: 30_000, totalMs: 50_000, redirects: 5 };
const EMPTY_MESSAGES = ['ไม่พบข้อมูล', 'ไม่พบโปรแกรมทัวร์ที่คุณค้นหา'];
const digits = (value) => value.replace(/[^0-9]/g, '');

class FormosaError extends Error {
  constructor(code, diagnostics) {
    super(code);
    this.diagnostics = diagnostics;
  }
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
    Vary: 'Authorization',
    ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}),
  } });
}

function authorized(header, token) {
  const supplied = /^Bearer ([^\s]+)$/i.exec(header || '')?.[1] || '';
  const hash = (value) => createHash('sha256').update(value, 'utf8').digest();
  // Fixed-length digests also handle tokens with different byte lengths safely.
  return timingSafeEqual(hash(supplied), hash(token));
}

function diagnostics(stage, response) {
  const result = { stage };
  if (response) {
    result.http_status = response.status;
    const ray = response.headers.get('cf-ray') || '';
    if (/^[a-f0-9]{8,32}-[a-z]{3}$/i.test(ray)) result.cf_ray = ray;
  }
  return result;
}

function readNonce(html, info) {
  const $ = load(html);
  for (const script of $('script').toArray()) {
    const object = $(script).text().match(/\bagent_ajax_object\s*=\s*\{([^{}]*)\}/s)?.[1];
    if (!object) continue;
    // Read the required literal; never execute upstream JavaScript.
    const nonce = object.match(/(?:^|,)\s*(?:["']nonce["']|nonce)\s*:\s*(["'])([a-zA-Z0-9_-]{1,128})\1/);
    if (nonce) return nonce[2];
  }
  throw new FormosaError('upstream_nonce_missing_check_session', info);
}

export function parseTours(html, info = { stage: 'ajax' }) {
  const $ = load(html);
  const articles = $('article.tour-agent-loop-item');
  if (!articles.length) {
    const message = $('body').text().replace(/\s+/gu, ' ').trim();
    if (!html.trim() || EMPTY_MESSAGES.some((value) => message.includes(value))) return [];
    throw new FormosaError('unexpected_tour_markup', info);
  }
  return articles.toArray().map((article) => {
    const tour = $(article);
    const text = (selector) => tour.find(selector).first().text().trim();
    const mainid = text('span.tour-no');
    if (!mainid) throw new FormosaError('upstream_tour_id_missing', info);
    const durationText = text('div.tour-date-night');
    const duration = durationText.match(/(\d+)\s*วัน\s*(\d+)\s*คืน/u)
      || durationText.match(/(\d+)\s*D\s*(\d+)\s*N/i);
    const flights = [];
    for (const [selector, direction] of [
      ['.tour-airline-start .air-row', 'depart'], ['.tour-airline-back .air-row', 'return'],
    ]) {
      tour.find(selector).each((_, row) => {
        const value = (s) => $(row).find(s).first().text().replace(/\s+/gu, ' ').trim();
        const [from_airport = '', to_airport = ''] = value('.airport-name').split('-').map((s) => s.trim());
        const [depart_time = '', arrive_time = ''] = value('.time').split('-').map((s) => s.trim());
        flights.push({ flight_direction: direction, from_airport, to_airport,
          flight_no: value('.flight'), depart_time, arrive_time });
      });
    }
    const period = [];
    tour.find('table').first().find('tr').each((_, row) => {
      const cells = $(row).children('td');
      if (cells.length < 10) return;
      const cell = (i) => cells.eq(i).text().trim();
      const currentPrice = (i) => {
        const sale = cells.eq(i).find('span.tour-price-sale').first();
        const content = (sale.length ? sale : cells.eq(i)).clone();
        content.find('del').remove();
        return digits(content.text());
      };
      const commissions = cell(9).split('+');
      period.push({
        tour_period: cell(1), price: currentPrice(2),
        price_old: digits(cells.eq(2).find('del').first().text()),
        'Chd+B': currentPrice(3), ChdNB: currentPrice(4), single: currentPrice(5),
        size: digits(cell(6)), Book: digits(cell(7)), AVBL: cell(8),
        comOffice: digits(commissions[0]), comSale: digits(commissions[1] || ''),
      });
    });
    return {
      mainid, title: text('h3.entry-title'),
      banner: tour.find('figure.entry-image img[src]').first().attr('src') || '',
      tour_day: Number(duration?.[1] || 0), tour_night: Number(duration?.[2] || 0),
      pdf: tour.find('a#pdf-file[href]').first().attr('href') || '',
      doc: tour.find('a#word-file[href]').first().attr('href') || '', flights, period,
    };
  });
}

async function collectTours({ country, page, cookie, signal, fetchImpl, limits }) {
  // One isolated, real cookie jar per inbound request, including nonce refreshes.
  // Sequential requests prevent session rotations racing with another page.
  const jar = new CookieJar();
  const deadline = Date.now() + limits.totalMs;
  let nonce;
  let lastInfo = { stage: 'nonce' };
  const ensureTime = (stage) => {
    if (signal?.aborted) throw new FormosaError('upstream_cancelled', { stage });
    if (Date.now() >= deadline) throw new FormosaError('upstream_deadline_exceeded', { stage });
  };

  async function upstream(path, stage, body) {
    ensureTime(stage);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, Math.min(limits.requestMs, deadline - Date.now()));
    signal?.addEventListener('abort', abort, { once: true });
    let info = { stage };
    try {
      let url = new URL(path, ORIGIN);
      for (let redirects = 0; ; redirects++) {
        // Validate before attaching credentials, including every redirect hop.
        if (url.origin !== ORIGIN || url.username || url.password) {
          throw new FormosaError('upstream_redirect_forbidden', info);
        }
        const response = await fetchImpl(url.href, {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'manual', cache: 'no-store', signal: controller.signal,
          headers: {
            Accept: body === undefined ? 'text/html' : 'application/json',
            'User-Agent': 'TravelzeedPartner/1.0',
            Cookie: await jar.getCookieString(url.href),
            ...(body === undefined ? {} : {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              Origin: ORIGIN, Referer: `${ORIGIN}/agent-tour-category/`,
            }),
          },
          ...(body === undefined ? {} : { body }),
        });
        info = diagnostics(stage, response);
        lastInfo = info;
        // Native Node fetch has no browser session. Store every Set-Cookie ourselves.
        for (const value of response.headers.getSetCookie()) {
          await jar.setCookie(value, url.href);
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects >= limits.redirects) throw new FormosaError('upstream_redirect_limit', info);
          if (body !== undefined && ![307, 308].includes(response.status)) {
            throw new FormosaError('upstream_post_redirect_rejected', info);
          }
          url = new URL(location, url);
          continue;
        }
        const text = await response.text();
        return { status: response.status, text, info };
      }
    } catch (error) {
      if (error instanceof FormosaError) throw error;
      throw new FormosaError(controller.signal.aborted ? 'upstream_timeout_or_cancelled' : 'upstream_connection_failed', info);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  async function refreshNonce() {
    const response = await upstream('/agent-tour-category/', 'nonce');
    if (response.status !== 200) throw new FormosaError('upstream_http_error', response.info);
    nonce = readNonce(response.text, response.info);
  }

  async function getPage(countryId, pageNumber) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = new URLSearchParams({
        action: 'tour_callback_agent_country', nonce, tour_keyword: '',
        tour_tax: 'tour-country', tour_tax_val: countryId, tour_cat: '', paged: String(pageNumber),
      });
      const response = await upstream('/wp-admin/admin-ajax.php', 'ajax', body);
      if ([200, 403].includes(response.status) && response.text.trim() === '-1') {
        if (attempt === 1) throw new FormosaError('upstream_nonce_rejected', response.info);
        await refreshNonce();
        continue;
      }
      if (response.status !== 200) throw new FormosaError('upstream_http_error', response.info);
      let data;
      try { data = JSON.parse(response.text); } catch {
        throw new FormosaError('upstream_ajax_invalid_response', response.info);
      }
      if (!data || typeof data.result !== 'string' || typeof data.pagination !== 'string') {
        throw new FormosaError('upstream_ajax_invalid_response', response.info);
      }
      return { tours: parseTours(data.result, response.info), lastPage: data.pagination === '' };
    }
  }

  try {
    for (const part of cookie.split(';')) {
      if (part.trim()) await jar.setCookie(`${part.trim()}; Path=/; Secure`, ORIGIN);
    }
    await refreshNonce();
    const tours = new Map();
    for (const countryId of country ? [country] : COUNTRY_IDS) {
      for (let n = page || 1; n <= limits.maxPages; n++) {
        const batch = await getPage(countryId, n);
        ensureTime('ajax');
        for (const tour of batch.tours) if (!tours.has(tour.mainid)) tours.set(tour.mainid, tour);
        if (page || !batch.tours.length || batch.lastPage) break;
        if (n === limits.maxPages) throw new FormosaError('pagination_limit_exceeded_use_page', lastInfo);
      }
    }
    return [...tours.values()];
  } catch (error) {
    if (error instanceof FormosaError) throw error;
    throw new FormosaError('formosa_fetch_failed', lastInfo);
  }
}

// Dependencies and limits may be injected by offline tests, never by query parameters.
export function createFormosaHandler({ fetchImpl = (...args) => fetch(...args), env = process.env, limits: overrides } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  return async function GET(request) {
    const token = env.FORMOSA_PROXY_TOKEN;
    if (!token || /\s/.test(token)) return json({ error: 'server_configuration_missing', statusCode: 503 }, 503);
    if (!authorized(request.headers.get('authorization'), token)) return json({ error: 'unauthorized', statusCode: 401 }, 401);
    const params = new URL(request.url).searchParams;
    const country = params.get('country');
    const pageValue = params.get('page');
    if ([...params.keys()].some((key) => !['country', 'page'].includes(key))
      || params.getAll('country').length > 1 || params.getAll('page').length > 1
      || (country !== null && !COUNTRY_IDS.includes(country))
      || (pageValue !== null && (!country || !/^[1-9]\d*$/.test(pageValue)
        || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) > limits.maxPages))) {
      return json({ error: 'invalid_country_or_page', statusCode: 400 }, 400);
    }
    if (!env.FORMOSA_COOKIE || /[\r\n]/.test(env.FORMOSA_COOKIE)) {
      return json({ error: 'server_configuration_missing', statusCode: 503 }, 503);
    }
    try {
      return json(await collectTours({ country, page: pageValue === null ? null : Number(pageValue),
        cookie: env.FORMOSA_COOKIE, signal: request.signal, fetchImpl, limits }));
    } catch (error) {
      return json({ error: error instanceof FormosaError ? error.message : 'formosa_fetch_failed', statusCode: 502,
        diagnostics: error instanceof FormosaError ? error.diagnostics : { stage: 'nonce' } }, 502);
    }
  };
}
