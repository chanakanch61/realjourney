export const metadata = {
  title: "Vercel Get Link",
  description: "Returns a plain-text link from /api/get-link",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
        {children}
      </body>
    </html>
  );
}
