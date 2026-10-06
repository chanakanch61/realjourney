import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 8 }}>API Ready ✅</h1>

      <p style={{ marginTop: 0, marginBottom: 16 }}>
        Open <code>/api/get-link</code> to get the link as plain text.
      </p>

      <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
        <li>
          <Link href="/api/get-link" prefetch={false} target="_blank">
            Go to /api/get-link
          </Link>
        </li>
        <li>
          <Link href="/api/season_holiday" prefetch={false} target="_blank">
            Go to /api/season_holiday
          </Link>
        </li>
        <li>
          <Link href="/api/htc" prefetch={false} target="_blank">
            Go to /api/htc
          </Link>
        </li>
        <li>
          <Link href="/api/totw" prefetch={false} target="_blank">
            Go to /api/totw
          </Link>
        </li>
           <li>
          <Link href="/api/formosa" prefetch={false} target="_blank">
            Go to /api/formosa
          </Link>
        </li>
      </ul>
    </main>
  );
}
