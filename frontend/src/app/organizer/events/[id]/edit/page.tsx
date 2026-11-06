'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Guard } from '@/components/AuthProvider';
import { EventForm, type ManagedEvent } from '@/components/EventForm';
import { Notice, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function EditEvent() {
  return <Guard roles={['organizer', 'admin']}><Loader /></Guard>;
}

function Loader() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<ManagedEvent | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<{ event: ManagedEvent }>(`/events/${id}/manage`).then((d) => setEvent(d.event)).catch((e) => setError(errorMessage(e))); }, [id]);
  if (error) return <Notice>{error}</Notice>;
  if (!event) return <Spinner />;
  if (event.status === 'CANCELLED' || event.status === 'COMPLETED') return <Notice tone="info">Cancelled and completed events can’t be edited.</Notice>;
  return <EventForm initial={event} />;
}
