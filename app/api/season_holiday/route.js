export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = searchParams.get("page") || 1;

  const targetUrl =
    `https://www.season.co.th/search-tour/?country=0&code=0&startdate=0&enddate=0&month=0&searchword=0&pagenum=${page}`;

  try {
    const r = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Vercel Proxy)",
        "Accept": "text/html",
      },
      cache: "no-store",
    });

    const text = await r.text();

    return new Response(text, {
      status: r.status,
      headers: {
        "Content-Type": r.headers.get("content-type") || "text/html",
      },
    });

  } catch (err) {
    return Response.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
