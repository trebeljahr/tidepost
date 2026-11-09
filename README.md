# tidepost

Schedule Instagram posts from your own Cloudflare account. No subscription, no third party holding your photos or your Instagram login.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/trebeljahr/tidepost)

- **Plan**: a queue and a month calendar of everything that is scheduled, drafted, published or failed.
- **Prepare**: drop in up to 20 photos, crop each one to 4:5, 1:1 or 1.91:1 in the browser, reorder them and add alt text.
- **Check**: see the post as it will look in the feed, and see where it lands on your profile grid among your real posts.
- **Approve**: nothing goes out until you approve it. Any edit after approval removes the approval.
- **Avoid repeats**: tidepost warns when a photo looks like one you already queued or posted.
- **Stay within limits**: the caption editor counts characters (2,200), hashtags (30) and @mentions (20) and blocks approval past them.

One deploy serves one person. There is no sign-up page; you sign in with a passkey.

## What it costs

Nothing on Cloudflare's free plan, and no card is needed. A busy month (60 posts, 300 photos) uses:

| Free-plan limit | tidepost's use |
|---|---|
| Workers: 100,000 requests/day | about 1,500 (one publisher run per minute plus your own clicks); the page itself is free static assets |
| Cron Triggers: 5 per account | 1 |
| D1: 5 million rows read, 100,000 written per day | a few thousand |
| KV: 1,000 writes/day, 1 GB | about 20 writes per post; photos are deleted right after they are published |

If you hit a free limit, Cloudflare pauses that part until midnight UTC; nothing is billed. tidepost then retries on the next run.

## Set up

### 1. Deploy

Click **Deploy to Cloudflare** above. Cloudflare copies this repository to your GitHub account, creates the database (D1) and photo store (KV) and deploys the Worker.

The form asks for one secret, `SETUP_CODE`: a long phrase (at least 12 characters) that you type once on your first visit. Keep a copy.

From a terminal instead:

```bash
git clone https://github.com/trebeljahr/tidepost && cd tidepost
pnpm install
npx wrangler login
npx wrangler secret put SETUP_CODE
pnpm run deploy
```

### Use your own domain (optional)

The domain's zone must be in the same Cloudflare account. Then either add it in the dashboard (Workers & Pages → tidepost → Domains → Add domain), or, when you deploy from a terminal, put it in a `.deploy.env` file next to `package.json`:

```bash
echo "TIDEPOST_DOMAIN=posts.example.com" > .deploy.env
pnpm run deploy
```

Register your passkey on the address you will use: a passkey only works on the host name it was created on.

### 2. Sign in

Open your Worker's address (shown after the deploy, `https://tidepost.<your-subdomain>.workers.dev`). Type the setup code, and your device creates a passkey. From then on you sign in with the passkey. Passkeys synced by your password manager (iCloud Keychain, Google Password Manager, 1Password) work on your other devices too; Settings → Passkeys adds more. If you lose every passkey, change `SETUP_CODE` in Cloudflare (Workers & Pages → tidepost → Settings → Variables and Secrets) and register again.

### 3. Connect Instagram

You create your own small Meta app. It only posts to your own account, so Meta does not need to review it. The same steps are in the app under Settings → setup guide.

1. **Make your account professional.** Instagram app: Settings → Account type and tools → Switch to professional account. Creator or Business both work. The account must be public. No Facebook Page is needed.
2. **Create a Meta developer account** at [developers.facebook.com](https://developers.facebook.com/).
3. **Create an app.** My Apps → Create app. Use case: "Manage messaging & content on Instagram". If you don't see it, pick "Other", then app type "Business". Skip the business portfolio.
4. **Open "API setup with Instagram login".**
5. **Add your account.** Under "Generate access tokens", click Add account and log in to Instagram. If Instagram shows a tester invite, accept it (Settings → Apps and websites).
6. **Generate a token**, allow access and copy it.
7. **Paste it into tidepost** under Settings → Instagram.
8. **Skip the rest of the page.** "Configure webhooks", "Set up Instagram business login" and "Complete app review" are not needed to post to your own account.

The token lasts 60 days. tidepost renews it every day. If tidepost is off for more than 60 days, generate a new token (step 6).

## How it works

```
your browser ── crop, resize, JPEG, duplicate check (all on your device)
     │
     ▼
tidepost Worker (your Cloudflare account)
  ├─ static UI
  ├─ /api/*            passkey session or API token
  ├─ /media/<id>?sig   signed links that expire after 1 hour, for Meta to fetch photos
  └─ cron every minute publish due posts · renew the token daily · mirror your grid
        │
  D1 (posts, settings) · KV (photos until published)
        │
        ▼
graph.instagram.com (Instagram API with Instagram Login)
```

Publishing takes a few minutes for a carousel: tidepost creates one container per photo, waits until Instagram has processed them, creates the carousel and publishes it. It saves its progress after every step, so a post is never published twice.

A post that is more than 6 hours late (for example after a free-plan pause) goes back to "needs approval" instead of going out at a surprising time.

## Privacy

- The Worker talks only to Instagram's API and Instagram's image servers (for your grid preview). There is no analytics, no telemetry and no update check.
- Photos stay in your KV until they are published, then they are deleted.
- `robots.txt` asks search engines to stay away.

## API

API tokens (Settings → API tokens) let your own scripts add drafts. Scopes: `read` (list posts) and `drafts` (create drafts, add photos, attach a caption suggestion). A third scope, `approve`, is off unless you tick it: it lets an app you host yourself edit, approve and publish posts (for example a private dashboard that embeds the tidepost editor). No token can change Instagram settings, passkeys or tokens.

```bash
curl -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"caption":"Low tide"}' https://tidepost.example.workers.dev/api/posts
curl -H "Authorization: Bearer $TOKEN" -H "content-type: image/jpeg" \
  --data-binary @photo.jpg https://tidepost.example.workers.dev/api/posts/<id>/items
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"suggestion":"…"}' https://tidepost.example.workers.dev/api/posts/<id>/suggestion
```

A suggestion shows up in the editor next to your caption. It is only used if you take it.

## Develop

```bash
pnpm install
cp .dev.vars.example .dev.vars          # set SETUP_CODE
pnpm run preview                        # build, migrate the local D1, wrangler dev
pnpm test                               # Worker tests run inside workerd with a fake Instagram API
```

Layout:

- `packages/worker`: the Worker (API, passkeys, publisher, token renewal) and D1 migrations
- `packages/ui`: the React UI as a package, so other apps can host it (`TidepostApp`, `setApiBase`)
- `packages/client`: the static Next.js page that hosts the UI
- `packages/shared`: Instagram limits shared by UI and Worker

## License

[AGPL-3.0-or-later](LICENSE). You can use, change and self-host tidepost freely. If you run a changed version for other people over a network, you must offer them its source code. Settings → About links to this repository. If you change the code, point `SOURCE_URL` in `packages/ui/src/components/settings.tsx` at your copy.
