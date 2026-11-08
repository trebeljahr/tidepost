// Instagram limits for feed posts (Content Publishing API, checked 2026-11-08).
export const MAX_CAPTION = 2200;
export const MAX_HASHTAGS = 30;
export const MAX_MENTIONS = 20;
export const MAX_ITEMS = 20;
export const MAX_ALT = 1000;
export const MAX_BYTES = 8 * 1024 * 1024;
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 1440;

export const ASPECTS = {
  "4:5": 4 / 5,
  "1:1": 1,
  "1.91:1": 1.91,
} as const;
export type Aspect = keyof typeof ASPECTS;
export const isAspect = (a: unknown): a is Aspect => typeof a === "string" && a in ASPECTS;

export interface CaptionStats {
  chars: number;
  hashtags: number;
  mentions: number;
}

export function captionStats(caption: string): CaptionStats {
  // Instagram counts characters as UTF-16 code units is not documented; count code points,
  // which is stricter for emoji than JS .length is lenient.
  const chars = [...caption].length;
  const hashtags = (caption.match(/(^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu) || []).length;
  const mentions = (caption.match(/(^|[^\p{L}\p{N}_.])@[A-Za-z0-9._]+/gu) || []).length;
  return { chars, hashtags, mentions };
}

export interface ItemLike {
  width: number;
  height: number;
  bytes: number;
  alt_text: string;
}

/** Problems that block approval. Empty list = ready. */
export function postProblems(caption: string, items: ItemLike[]): string[] {
  const p: string[] = [];
  const s = captionStats(caption);
  if (s.chars > MAX_CAPTION) p.push(`Caption has ${s.chars} characters; Instagram allows ${MAX_CAPTION}.`);
  if (s.hashtags > MAX_HASHTAGS) p.push(`Caption has ${s.hashtags} hashtags; Instagram allows ${MAX_HASHTAGS}.`);
  if (s.mentions > MAX_MENTIONS) p.push(`Caption has ${s.mentions} @mentions; Instagram allows ${MAX_MENTIONS}.`);
  if (items.length === 0) p.push("Add at least one photo.");
  if (items.length > MAX_ITEMS) p.push(`A post can have ${MAX_ITEMS} photos at most.`);
  items.forEach((it, i) => {
    const r = it.width / it.height;
    if (r < 0.8 - 0.01 || r > 1.91 + 0.01) p.push(`Photo ${i + 1} is ${it.width}×${it.height}; Instagram needs 4:5 to 1.91:1.`);
    if (it.width < MIN_WIDTH || it.width > MAX_WIDTH) p.push(`Photo ${i + 1} is ${it.width} px wide; Instagram needs ${MIN_WIDTH}–${MAX_WIDTH}.`);
    if (it.bytes > MAX_BYTES) p.push(`Photo ${i + 1} is larger than 8 MB.`);
    if ([...it.alt_text].length > MAX_ALT) p.push(`Alt text of photo ${i + 1} is longer than ${MAX_ALT} characters.`);
  });
  return p;
}

/** Hamming distance between two 64-bit dHashes in hex. */
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}
export const DUPLICATE_DISTANCE = 6;
