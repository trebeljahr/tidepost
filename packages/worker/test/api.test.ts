import { captionStats, hamming, postProblems } from "@starter/shared/limits";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { jpegSize } from "../src/api";
import type { Env } from "../src/env";
import { signedMediaUrl } from "../src/media";

const E = env as unknown as Env;
const SELF = (exports as unknown as { default: Fetcher }).default;

/** Minimal JPEG header with an SOF0 segment for the given size. */
function fakeJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9]);
}

describe("limits", () => {
  it("counts hashtags and mentions", () => {
    expect(captionStats("Tide #one #two and @rico, mail me@example.com #3d")).toEqual({ chars: 49, hashtags: 3, mentions: 1 });
  });

  it("blocks over-long captions and wrong aspect ratios", () => {
    const ok = { width: 1080, height: 1350, bytes: 1000, alt_text: "" };
    expect(postProblems("hi", [ok])).toEqual([]);
    expect(postProblems("x".repeat(2201), [ok])[0]).toMatch(/2201 characters/);
    expect(postProblems("hi", [{ ...ok, height: 1500 }])[0]).toMatch(/4:5 to 1.91:1/);
    expect(postProblems("hi", [])).toEqual(["Add at least one photo."]);
  });

  it("measures dHash distance", () => {
    expect(hamming("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(hamming("0000000000000000", "000000000000000f")).toBe(4);
  });
});

describe("jpeg", () => {
  it("reads the size from the SOF marker", () => {
    expect(jpegSize(fakeJpeg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe("http", () => {
  it("refuses the API without a session", async () => {
    const res = await SELF.fetch("https://tp.example/api/posts");
    expect(res.status).toBe(401);
  });

  it("reports setup as open with a good setup code and no passkeys", async () => {
    const res = await SELF.fetch("https://tp.example/api/auth/state");
    expect(await res.json()).toEqual({ signedIn: false, setup: "open" });
  });

  it("rejects a wrong setup code", async () => {
    const res = await SELF.fetch("https://tp.example/api/auth/setup/options", { method: "POST", body: JSON.stringify({ code: "nope" }) });
    expect(res.status).toBe(403);
  });

  it("serves a photo only with a valid, unexpired signature", async () => {
    await E.DB.prepare("INSERT INTO posts (id, created_at, updated_at) VALUES ('p', 0, 0)").run();
    await E.DB.prepare("INSERT INTO items (id, post_id, position, kv_key, width, height, bytes, uploaded_at) VALUES ('i', 'p', 0, 'photo/i', 1080, 1350, 29, 0)").run();
    await E.PHOTOS.put("photo/i", fakeJpeg(1080, 1350));
    const now = Math.floor(Date.now() / 1000);
    const good = await signedMediaUrl(E, "https://tp.example", "i", now);
    const ok = await SELF.fetch(good);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect((await SELF.fetch(good.replace(/sig=.*/, "sig=forged"))).status).toBe(404);
    const old = await signedMediaUrl(E, "https://tp.example", "i", now - 7200);
    expect((await SELF.fetch(old)).status).toBe(404);
  });
});
