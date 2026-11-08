"use client";

import type { ReactNode } from "react";
import { Card } from "./ui";

/** Meta setup, checked against Meta's docs on 2026-11-08 (Instagram API with Instagram Login, v27.0). */
export function Guide(): ReactNode {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed text-zinc-300">
      <Card>
        <h2 className="mb-2 text-base font-medium text-zinc-100">Connect Instagram (about 10 minutes, once)</h2>
        <p className="mb-3 text-zinc-400">You create your own small Meta app. It only ever posts to your own account, so it needs no review by Meta.</p>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <b>Make your account professional.</b> In the Instagram app: Settings → Account type and tools → Switch to professional account. Creator or Business both work. The account must be public. You do not need a Facebook Page.
          </li>
          <li>
            <b>Create a Meta developer account</b> at{" "}
            <a className="text-sky-300 hover:underline" href="https://developers.facebook.com/" target="_blank" rel="noreferrer">
              developers.facebook.com
            </a>{" "}
            and log in.
          </li>
          <li>
            <b>Create an app.</b> My Apps → Create app. Pick the use case “Manage messaging &amp; content on Instagram”. If you do not see it, pick “Other”, then app type “Business”. Any name works. You can skip the business portfolio.
          </li>
          <li>
            <b>Open “API setup with Instagram login”</b> (Instagram → Set up, if it is not open already).
          </li>
          <li>
            <b>Add your account.</b> Under “Generate access tokens”, click Add account and log in to Instagram. If Instagram shows a tester invite, accept it (Instagram: Settings → Apps and websites).
          </li>
          <li>
            <b>Generate a token.</b> Click Generate token next to your account, allow access and copy the token.
          </li>
          <li>
            <b>Paste it here</b> under Settings → Instagram. tidepost shows “Connected as @you”.
          </li>
          <li>
            <b>Skip the rest of Meta&apos;s page.</b> “Configure webhooks”, “Set up Instagram business login” and “Complete app review” are not needed to post to your own account.
          </li>
        </ol>
        <p className="mt-3 text-zinc-400">The token lasts 60 days and tidepost renews it every day. If tidepost is switched off for more than 60 days, repeat step 6.</p>
      </Card>
      <Card>
        <h2 className="mb-2 text-base font-medium text-zinc-100">What Instagram allows</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Up to 20 photos per carousel. Every photo is shown in the first photo&apos;s shape.</li>
          <li>Shapes from 4:5 (portrait) to 1.91:1 (landscape). JPEG, up to 8 MB. tidepost crops and converts in your browser.</li>
          <li>Captions up to 2,200 characters, 30 hashtags and 20 @mentions.</li>
          <li>Up to 50 posts per 24 hours through the API.</li>
          <li>Alt text up to 1,000 characters per photo.</li>
        </ul>
      </Card>
    </div>
  );
}
