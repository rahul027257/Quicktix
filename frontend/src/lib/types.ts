export type Role = 'customer' | 'organizer' | 'admin';
export interface User { id: string; name: string; email: string; role: Role }
export interface OrganizerRequest {
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; organizationName: string; description: string;
  contactPhone: string; website: string | null; rejectionReason: string | null;
}
export interface EventCardData {
  id: string; title: string; category: string; venue: string; city: string; startsAt: string; endsAt: string | null;
  pricePaise: number; available: number; capacity: number; status: string; bannerUrl: string | null;
  organizer: { id: string; name: string };
}
export interface EventSummary {
  id: string; title: string; category: string; venue: string; city: string; startsAt: string; endsAt: string | null;
  pricePaise: number; available: number; capacity: number; status: string; bannerUrl: string | null;
}
export interface TicketData { id: string; ticketNumber: number; status: string; used: boolean; checkedInAt: string | null; code?: string }
export interface BookingView {
  id: string; reference: string; status: string; quantity: number; unitPricePaise: number; totalPaise: number;
  utr: string | null; hasScreenshot: boolean; submittedAt: string | null; rejectionReason: string | null; createdAt: string;
  hold: { status: string; expiresAt: string }; serverNow: string; event: EventSummary;
  payment: { upiId: string; upiQrUrl: string; amountPaise: number; upiLink: string } | null;
  tickets: TicketData[];
}
export interface BookingListItem {
  id: string; reference: string; status: string; quantity: number; totalPaise: number; createdAt: string;
  rejectionReason: string | null; holdExpiresAt: string; event: EventSummary; tickets: { id: string; ticketNumber: number; used: boolean }[];
}
