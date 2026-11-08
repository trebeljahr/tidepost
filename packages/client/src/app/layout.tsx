import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { DeployRecovery } from "../components/deploy-recovery";

export const metadata: Metadata = {
  title: {
    default: "My App",
    template: "%s | My App",
  },
  description: "A full-stack web application",
};

/*
 * `viewport-fit=cover` ships to EVERY host, web included.
 *
 * One static export serves the browser, the installed web app and both
 * native shells, and this export is static — so there is no build in
 * which the meta tag can be left out for web. A normal mobile browser
 * applies no insets, so it is harmless there. An INSTALLED web app gets
 * the real insets with none of styles/native.css applying to it, and
 * content runs under the notch. styles/standalone.css is the answer, and
 * is a separate file from native.css precisely because it is not inert by
 * construction.
 *
 * Note what is deliberately absent: `maximumScale: 1` / `userScalable:
 * false`. Stopping iOS from zooming a focused field by taking zoom away
 * from everyone is not a trade worth making — native.css sets 16px fields
 * under the root marker instead.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/*
          A ternary, never `domain && <script/>`. CI passes "" when the repo
          variable is unset, and `"" && …` renders "" as a text node in
          <head>. The exported HTML has none, hydration fails (React #418),
          and React's client re-render drops every <link> in <head> — the
          stylesheet included. e2e/export/landing-styles.spec.ts checks it.
        */}
        {process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ? (
          <script
            defer
            data-domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN}
            src={
              process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL ||
              "https://plausible.io/js/script.js"
            }
          />
        ) : null}
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {/* Offers a reload when this tab's bundle is older than the one
            being served, and recovers a chunk that no longer exists. Pass
            this app's writes in as `writes` so the offer waits for one in
            flight. Does nothing in development or in a native shell. */}
        <DeployRecovery />
        {children}
      </body>
    </html>
  );
}
