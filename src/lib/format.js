const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(iso) {
  if (!iso) return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Compact relative time for dense rows: now, 12m, 3h, 2d, Mar 4. */
export function formatRelative(iso) {
  const date = parseDate(iso);
  if (!date) return "—";
  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());

  if (diff < 60 * 1000) return "now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3600000)}h`;

  const dayDiff = Math.floor(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS
  );
  if (dayDiff <= 1) return "1d";
  if (dayDiff < 7) return `${dayDiff}d`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
  }
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Clock time, e.g. 9:41 AM. Used when date_format is "absolute". */
export function formatTime(iso) {
  const date = parseDate(iso);
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

/** Full date and time for tooltips and article headers. */
export function formatFullDate(iso) {
  const date = parseDate(iso);
  if (!date) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

/** Date bucket for the article list: Today / Yesterday / This week / Earlier. */
export function formatDateGroup(iso, now = new Date()) {
  const date = parseDate(iso);
  if (!date) return "Earlier";
  const diffDays = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS
  );
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  return "Earlier";
}

/** Hostname without www, for compact source labels and onboarding cards. */
export function hostOf(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return String(url)
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0];
  }
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision).replace(/\.0+$/, "")} ${units[index]}`;
}

/** Backend sends minutes; return copy that reads naturally in the reader. */
export function readingTime(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return "<1 min read";
  const rounded = Math.max(1, Math.round(n));
  return `${rounded} min read`;
}
