import { API_BASE_URL } from "../config";
import { ApiError } from "./types";

export interface DeviceCredentials {
  deviceId: string;
  deviceToken: string;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; device?: DeviceCredentials } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.device) {
    headers["x-device-id"] = options.device.deviceId;
    headers["x-device-token"] = options.device.deviceToken;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, data?.message ?? "Erro na API");
  }

  return data as T;
}

export const api = {
  createValidatorSession: (eventId: string, pin: string, deviceName: string) =>
    request<import("./types").ValidatorSessionResponse>("/v1/validator/sessions", {
      method: "POST",
      body: { session: { eventId, pin }, device: { name: deviceName } },
    }),

  refreshDeviceToken: (device: DeviceCredentials) =>
    request<{ deviceId: string; deviceToken: string }>(
      `/v1/validator/devices/${device.deviceId}/refresh`,
      { method: "POST", device },
    ),

  getManifest: (eventId: string, device: DeviceCredentials, since?: string) =>
    request<import("./types").ManifestResponse>(
      `/v1/validator/events/${eventId}/manifest${since ? `/delta?since=${encodeURIComponent(since)}` : ""}`,
      { device },
    ),

  checkin: (
    device: DeviceCredentials,
    input: { qrToken?: string; code?: string; checkinPointId?: string; scannedAt?: string },
  ) =>
    request<import("./types").CheckinResponse>("/v1/checkins", {
      method: "POST",
      body: input,
      device,
    }),

  syncCheckins: (
    device: DeviceCredentials,
    batchKey: string,
    items: import("./types").SyncCheckinItemInput[],
  ) =>
    request<import("./types").SyncCheckinsResponse>("/v1/checkins/sync", {
      method: "POST",
      body: { batchKey, items },
      device,
    }),
};
