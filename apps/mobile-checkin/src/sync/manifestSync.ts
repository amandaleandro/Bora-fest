import { api, type DeviceCredentials } from "../api/client";
import { getMeta, upsertManifest } from "../db/database";

/** Busca o manifesto completo na primeira vez, ou só o delta depois. */
export async function syncManifest(eventId: string, device: DeviceCredentials): Promise<number> {
  const since = getMeta("manifestVersion") ?? undefined;
  const manifest = await api.getManifest(eventId, device, since);
  upsertManifest(manifest);
  return manifest.ticketCount;
}
