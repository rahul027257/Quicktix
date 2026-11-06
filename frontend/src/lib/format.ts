export const TZ = 'Asia/Kolkata';

export const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...o });
export const fmtDateTime = (iso: string) => fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtDay = (iso: string) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
export const fmtTime = (iso: string) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtShort = (iso: string) => fmt({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** <input type="datetime-local"> values are treated as India time, matching how events are displayed. */
export const toIstInput = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
export const fromIstInput = (v: string) => new Date(`${v}:00+05:30`).toISOString();

export const CATEGORIES = [
  { value: 'CONCERTS', label: 'Concerts' },
  { value: 'SPORTS', label: 'Sports' },
  { value: 'MOVIES', label: 'Movies' },
  { value: 'COMEDY_SHOWS', label: 'Comedy Shows' },
  { value: 'WORKSHOPS', label: 'Workshops' },
  { value: 'CONFERENCES', label: 'Conferences' },
  { value: 'FESTIVALS', label: 'Festivals' },
  { value: 'EXHIBITIONS', label: 'Exhibitions' },
  { value: 'COLLEGE_EVENTS', label: 'College Events' },
  { value: 'OTHERS', label: 'Others' },
] as const;
export const categoryLabel = (v: string) => CATEGORIES.find((c) => c.value === v)?.label ?? v;

// Each category gets its own banner colour when an organizer has not uploaded an image.
export const CATEGORY_BG: Record<string, string> = {
  CONCERTS: 'linear-gradient(135deg,#3D2FD9,#9B6BFF)',
  SPORTS: 'linear-gradient(135deg,#0B7A5C,#6BD6A8)',
  MOVIES: 'linear-gradient(135deg,#17143A,#5A4FD0)',
  COMEDY_SHOWS: 'linear-gradient(135deg,#E8590C,#FFC53D)',
  WORKSHOPS: 'linear-gradient(135deg,#0F6FA8,#7CC8F0)',
  CONFERENCES: 'linear-gradient(135deg,#2B2A5E,#6E7BE8)',
  FESTIVALS: 'linear-gradient(135deg,#C2255C,#FF8FB1)',
  EXHIBITIONS: 'linear-gradient(135deg,#7A4B12,#E3B66B)',
  COLLEGE_EVENTS: 'linear-gradient(135deg,#5B2AA8,#D49BFF)',
  OTHERS: 'linear-gradient(135deg,#4A4670,#A9A5D6)',
};

export const STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: 'Awaiting payment', PENDING_ORGANIZER_VERIFICATION: 'Pending approval', CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected', EXPIRED: 'Expired', CANCELLED: 'Cancelled',
  DRAFT: 'Draft', PUBLISHED: 'Published', SOLD_OUT: 'Sold out', COMPLETED: 'Completed',
  PENDING: 'Pending', APPROVED: 'Approved',
};
export const STATUS_TONE: Record<string, string> = {
  CONFIRMED: 'bg-ok-soft text-ok', PUBLISHED: 'bg-ok-soft text-ok', APPROVED: 'bg-ok-soft text-ok',
  PENDING_ORGANIZER_VERIFICATION: 'bg-warn-soft text-warn', AWAITING_PAYMENT: 'bg-warn-soft text-warn', PENDING: 'bg-warn-soft text-warn',
  SOLD_OUT: 'bg-warn-soft text-warn',
  REJECTED: 'bg-bad-soft text-bad', CANCELLED: 'bg-bad-soft text-bad', EXPIRED: 'bg-lilac/60 text-ink-soft',
  DRAFT: 'bg-lilac/60 text-ink-soft', COMPLETED: 'bg-lilac/60 text-ink-soft',
};
