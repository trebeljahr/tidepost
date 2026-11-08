import type { MetadataRoute } from "next";

export const dynamic = "force-static";

/** A tidepost instance is a private tool for one person: keep it out of search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
