const pad = (n: number): string => String(n).padStart(2, "0");

/** Unix seconds -> value for <input type="datetime-local"> in the browser's time zone. */
export function toLocalInput(sec: number | null): string {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export function fmt(sec: number | null, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }): string {
  if (!sec) return "no time";
  return new Date(sec * 1000).toLocaleString(undefined, opts);
}

export function dayKey(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function relative(sec: number | null, now = Date.now() / 1000): string {
  if (!sec) return "";
  const d = sec - now;
  const a = Math.abs(d);
  const unit = a < 3600 ? [Math.round(a / 60), "min"] : a < 86400 ? [Math.round(a / 3600), "h"] : [Math.round(a / 86400), "d"];
  return d >= 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
}
