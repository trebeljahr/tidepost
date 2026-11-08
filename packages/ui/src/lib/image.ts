import { ASPECTS, type Aspect, MAX_BYTES } from "@starter/shared/limits";

/** A photo picked in the browser, before upload. */
export interface Pending {
  key: string;
  name: string;
  src: string; // object URL of the original
  w: number;
  h: number;
  offset: number; // 0..1 along the long side
  alt: string;
  dhash?: string;
  duplicateOf?: string;
}

export const OUTPUT_WIDTH = 1080;

export async function readFile(file: File): Promise<Pending> {
  const src = URL.createObjectURL(file);
  const image = await loadImage(src).catch(() => {
    URL.revokeObjectURL(src);
    throw new Error(`${file.name} is not an image this browser can open. HEIC photos: export them as JPEG first.`);
  });
  return { key: `${file.name}-${Math.random().toString(36).slice(2)}`, name: file.name, src, w: image.naturalWidth, h: image.naturalHeight, offset: 0.5, alt: "" };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("cannot decode image"));
    image.src = src;
  });
}

/** The crop box for the post's shape, slid along the photo's long side by `offset`. */
export function cropBox(p: Pick<Pending, "w" | "h" | "offset">, aspect: Aspect): { x: number; y: number; w: number; h: number } {
  const ratio = ASPECTS[aspect];
  if (p.w / p.h > ratio) {
    const w = Math.round(p.h * ratio);
    return { x: Math.round((p.w - w) * p.offset), y: 0, w, h: p.h };
  }
  const h = Math.round(p.w / ratio);
  return { x: 0, y: Math.round((p.h - h) * p.offset), w: p.w, h };
}

/** Crop, resize to 1080 px wide and encode as JPEG (sRGB canvas), staying under 8 MB. */
export async function exportJpeg(p: Pending, aspect: Aspect): Promise<{ blob: Blob; width: number; height: number; dhash: string }> {
  const image = await loadImage(p.src);
  const box = cropBox(p, aspect);
  const width = Math.min(OUTPUT_WIDTH, box.w);
  const height = Math.round((box.h * width) / box.w);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw images (no canvas).");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, width, height);
  let quality = 0.92;
  let blob = await toBlob(canvas, quality);
  while (blob.size > MAX_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await toBlob(canvas, quality);
  }
  return { blob, width, height, dhash: dhashOf(canvas) };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("JPEG export failed"))), "image/jpeg", quality));
}

/** 64-bit difference hash: 9×8 greyscale, compare neighbours. Robust to resizing and re-encoding. */
export function dhashOf(source: CanvasImageSource): string {
  const c = document.createElement("canvas");
  c.width = 9;
  c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "0000000000000000";
  ctx.drawImage(source, 0, 0, 9, 8);
  const d = ctx.getImageData(0, 0, 9, 8).data;
  const grey = (x: number, y: number): number => {
    const i = (y * 9 + x) * 4;
    return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  };
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (grey(x, y) > grey(x + 1, y) ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function dhashOfUrl(url: string): Promise<string> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const src = URL.createObjectURL(await res.blob());
  try {
    return dhashOf(await loadImage(src));
  } finally {
    URL.revokeObjectURL(src);
  }
}
