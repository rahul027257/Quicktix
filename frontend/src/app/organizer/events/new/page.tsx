'use client';

import { Guard } from '@/components/AuthProvider';
import { EventForm } from '@/components/EventForm';

export default function NewEvent() {
  return <Guard roles={['organizer', 'admin']}><EventForm /></Guard>;
}
