import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { Navbar } from '@/components/Navbar';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'QuickTix: events, tickets, done', template: '%s · QuickTix' },
  description: 'Discover concerts, comedy, sports, workshops and more. Book in minutes with UPI.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#F6F4FF' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <AuthProvider>
          <Navbar />
          <main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-8">{children}</main>
          <footer className="border-t border-lilac/70 py-8 text-center text-sm text-ink-soft">
            QuickTix. Payments go directly from you to the event organizer via UPI.
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
