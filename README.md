# Vercel Get Link (Next.js App Router)

## Formosa API

Requires Node.js 22 or newer. Install dependencies with `npm install`.
Configure `FORMOSA_CONFIG` near the top of `app/api/formosa/route.js` directly:
`proxyToken` contains the generated API secret; paste your authenticated Formosa
Cookie request-header value into `cookie`. Call the API with that `proxyToken`.
Restart locally or redeploy after changing these settings.

Optionally, the following in `.env.local` or the deployment environment override
the code settings:

```dotenv
FORMOSA_PROXY_TOKEN=replace-with-your-own-secret
FORMOSA_COOKIE="replace-with-a-valid-formosa-session-cookie"
```

Send `Authorization: Bearer <FORMOSA_PROXY_TOKEN>` to `/api/formosa`.
The cookie must come from an authenticated Formosa session; update it when the
API reports `session_expired_update_FORMOSA_COOKIE`.

- `/api/formosa?country=6&page=1`: fetch one page (pages 1–50 supported).
- `/api/formosa?country=6`: fetch one country until an empty page.
- `/api/formosa`: fetch all supported countries, at most three concurrently.

Automatic pagination has a safety limit of 50 pages per country and a shared
50-second request budget. Reaching the limit returns an error, never partial
success. For timeouts, use separate country or page requests. Successful responses
remain arrays of tours. Configuration errors return 503; invalid credentials 401;
invalid query parameters 400; upstream failures 502; timeouts 504.

Run the offline integration checks with `node --test tests/formosa.test.js`.

## 1) Install
```bash
npm install
```

## 2) Run locally
```bash
npm run dev
```
Then open:
- http://localhost:3000
- http://localhost:3000/api/get-link  (plain-text link)

## 3) Deploy to Vercel
- Push this folder to GitHub
- In Vercel: New Project -> Import your repo -> Deploy
- After deploy, open: `https://YOUR_DOMAIN.vercel.app/api/get-link`
"# realjourney" 
"# realjourney" 
"# realjourney" 
"# realjourney" 
