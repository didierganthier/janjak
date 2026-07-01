// ─── Janjak ClientOps — shared helpers ──────────────────────────────

/** Parse a due-date argument. Accepts YYYY-MM-DD or a few keywords. */
export function parseDueDate(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  const today = new Date();
  const iso = (d: Date) => {
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${yr}-${mo}-${da}`;
  };

  if (raw === "today") return iso(today);
  if (raw === "tomorrow") {
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    return iso(t);
  }
  if (raw === "next-week" || raw === "nextweek") {
    const t = new Date(today);
    t.setDate(t.getDate() + 7);
    return iso(t);
  }
  // Already an ISO-ish date? Keep the date portion.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // Fall back to Date parsing; return null if unrecognized.
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : iso(parsed);
}

/** Format a money amount with its currency (e.g. "$1,500" / "1500 HTG"). */
export function formatMoney(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null) return "—";
  const rounded = Number.isInteger(amount) ? amount : Math.round(amount * 100) / 100;
  const grouped = rounded.toLocaleString("en-US");
  if (currency === "USD") return `$${grouped}`;
  return `${grouped} ${currency}`;
}

/** Whether an ISO date string (YYYY-MM-DD) is strictly before today. */
export function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate.slice(0, 10) + "T23:59:59");
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
}

/** Days until a due date (negative = overdue). Null if no/invalid date. */
export function daysUntil(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(due.getTime())) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}
