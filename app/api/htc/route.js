export async function GET() {
  const targetUrl =
    "https://holidaytourcenter.com/wp-admin/admin-ajax.php?v=1.4.26&mode=searchresultsproduct&pagesize=60&pagenumber=1&sortby=price&page=1&action=get_tours_ajax";

  try {
    const r = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Vercel Proxy)",
      },
      cache: "no-store",
    });

    const text = await r.text(); // ใช้ text กันกรณีไม่ใช่ JSON

    return new Response(text, {
      status: r.status,
      headers: {
        "Content-Type": r.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
