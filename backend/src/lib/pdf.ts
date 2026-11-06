import type { Writable } from 'node:stream';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { config } from '../config';

const INK = '#17143A';
const BRAND = '#3D2FD9';
const MUTED = '#6B6890';

// PDFKit's built-in fonts are WinAnsi only: keep text printable instead of showing garbage glyphs.
const safe = (s: string) => s.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
const when = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: config.timezone, dateStyle: 'full', timeStyle: 'short' }).format(d);
const rupees = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

export interface PassData {
  reference: string;
  attendee: string;
  event: { title: string; venue: string; city: string; startsAt: Date; category: string };
  unitPricePaise: number;
  tickets: { ticketNumber: number; code: string }[];
}

/** One A5 pass per ticket, each carrying its own entry QR code. */
export async function writeTicketPdf(out: Writable, data: PassData) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    info: { Title: `QuickTix ${data.reference}`, Author: 'QuickTix', Subject: safe(data.event.title) },
  });
  doc.pipe(out);
  const total = data.tickets.length;

  for (const t of data.tickets) {
    doc.addPage({ size: 'A5', margin: 0 });
    const W = doc.page.width;
    const pad = 32;

    doc.rect(0, 0, W, 84).fill(INK);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26).text('QuickTix', pad, 28, { lineBreak: false });
    doc.font('Helvetica').fontSize(11).fillColor('#CFCBFF').text('Entry pass', 0, 38, { width: W - pad, align: 'right' });

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(safe(data.event.title), pad, 108, { width: W - pad * 2, height: 52, ellipsis: true });
    let y = doc.y + 14;
    const row = (label: string, value: string) => {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(label, pad, y, { width: W - pad * 2 });
      doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(safe(value), pad, doc.y + 1, { width: W - pad * 2 });
      y = doc.y + 8;
    };
    row('Date and time', when(data.event.startsAt));
    row('Venue', `${data.event.venue}, ${data.event.city}`);
    row('Attendee', data.attendee);
    row('Booking reference', data.reference);

    doc.roundedRect(pad, y + 2, 112, 24, 12).fill(BRAND);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text(`Ticket ${t.ticketNumber} of ${total}`, pad, y + 8, { width: 112, align: 'center' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(rupees(data.unitPricePaise), pad + 124, y + 8, { lineBreak: false });

    // Perforation between details and the scannable stub.
    const perfY = 356;
    doc.save().dash(4, { space: 4 }).moveTo(pad + 10, perfY).lineTo(W - pad - 10, perfY).strokeColor('#B9B5E8').lineWidth(1).stroke().undash().restore();
    doc.circle(0, perfY, 11).fill('#FFFFFF').circle(W, perfY, 11).fill('#FFFFFF');

    const qr = await QRCode.toBuffer(`quicktix:${t.code}`, { type: 'png', margin: 1, width: 480, errorCorrectionLevel: 'M' });
    const size = 150;
    doc.image(qr, (W - size) / 2, perfY + 16, { width: size, height: size });
    doc.font('Courier').fontSize(8).fillColor(MUTED).text(t.code, 0, perfY + 16 + size + 8, { width: W, align: 'center' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('Show this QR code at the entrance. It admits one person and works once.', pad, 562, { width: W - pad * 2, align: 'center' });
  }
  doc.end();
}
