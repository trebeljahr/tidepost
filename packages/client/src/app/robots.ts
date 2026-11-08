import type { MetadataRoute } from "next";

// Written once, at build time, as /robots.txt.
export const dynamic = "force-static";

const SITE_URL = "https://tidepost.example.com";

/**
 * The domain's ONE robots file.
 *
 * A crawler reads exactly one robots.txt per host, the one at its root, so
 * this file speaks for the whole domain — including the docs at /docs/,
 * which are a separate build copied into this app's output
 * (scripts/docs/build-into-client.mjs).
 *
 * That is why both sitemaps are named here, and why the copy step fails the
 * build if the docs bring a robots file of their own: a second one is
 * served, never requested, and states beliefs about the site that nothing
 * acts on.
 *
 * The docs sitemap carries no last-modified dates. Site generators read
 * those from git history, and an image build context has no repository —
 * worse, a git binary with no repository around it fails the build
 * outright, so the docs config must not reach for one. Missing lastmod
 * costs nothing: crawlers treat it as a hint and refetch anyway.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/docs/sitemap.xml`],
  };
}
