import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { EventPurchaseForm } from "./EventPurchaseForm";

export default async function EventPage({ params }: { params: { slug: string } }) {
  let event;
  let availability;
  try {
    [event, availability] = await Promise.all([
      api.getPublicEvent(params.slug),
      api.getAvailability(params.slug),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const availabilityByLot = new Map(availability.map((item) => [item.lotId, item]));

  return (
    <main className="px-4 py-10">
      <h1 className="text-3xl font-bold">{event.title}</h1>
      <p className="mt-2 text-sm text-gray-400">{formatDateTime(event.startsAt, event.timezone)}</p>
      {event.venue ? (
        <p className="mt-1 text-sm text-gray-400">
          {event.venue.name} — {event.venue.city}/{event.venue.state}
        </p>
      ) : null}
      {event.description ? <p className="mt-4 text-gray-300">{event.description}</p> : null}

      <EventPurchaseForm event={event} availabilityByLot={Object.fromEntries(availabilityByLot)} />
    </main>
  );
}
