import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { DeployRecovery } from "../components/deploy-recovery";

export const metadata: Metadata = {
  title: {
    default: "tidepost",
    template: "%s | tidepost",
  },
  description: "Your own Instagram scheduler.",
};

// No `maximumScale: 1` / `userScalable: false`: taking zoom away from
// everyone is not worth stopping iOS from zooming a focused field.
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
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-200 antialiased">
        {/* Offers a reload when this tab's bundle is older than the one
            being served, and recovers a chunk that no longer exists. Pass
            this app's writes in as `writes` so the offer waits for one in
            flight. Does nothing in development. */}
        <DeployRecovery />
        {children}
      </body>
    </html>
  );
}
