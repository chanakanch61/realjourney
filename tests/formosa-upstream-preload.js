// LOCAL TEST ONLY: replace upstream fetch in the Next.js server process.
// This is not a Formosa connectivity test. Never load this module on hosting.
import { article, noncePage, ajaxPage } from './fixtures/formosa.js';

if (process.env.FORMOSA_COOKIE !== 'session=fixture-cookie'
  || process.env.FORMOSA_PROXY_TOKEN !== 'fixture-token') {
  throw new Error('Upstream fixture preload requires isolated test environment');
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'https://formosajourneyland.co.th') return nativeFetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.get('cookie')?.includes('session=fixture-cookie')) {
    throw new Error('Missing fixture session');
  }
  if (url.pathname === '/agent-tour-category/' && init.method === 'GET') return noncePage();
  if (url.pathname !== '/wp-admin/admin-ajax.php' || init.method !== 'POST') {
    throw new Error('Unexpected fixture upstream request');
  }
  const fields = new URLSearchParams(init.body);
  const country = fields.get('tour_tax_val');
  const page = Number(fields.get('paged'));
  if (country === '6' && page === 2) {
    return new Response('private-error-detail', { status: 503, headers: { 'cf-ray': '0123456789abcdef-BKK' } });
  }
  if (country === '14') return new Response('private-error-detail', { status: 403 });
  return ajaxPage(article(page < 7 ? 'duplicate' : 'new-on-page-7'), page < 8 ? 'next' : '');
};
