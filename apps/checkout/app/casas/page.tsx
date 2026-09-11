import type { Metadata } from "next";
import { API_BASE_URL } from "../../lib/config";
import type { HouseListResponse } from "../../lib/houses-api";
import { CasasClient } from "./CasasClient";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Casas e produtores | BoraFest",
  description: "Descubra casas, atléticas e produtores com agenda ativa na BoraFest.",
};

async function loadHouses(): Promise<HouseListResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/v1/public/casas?pageSize=24&page=1`, { next: { revalidate: 60 } });
    if (!response.ok) return null;
    return (await response.json()) as HouseListResponse;
  } catch {
    return null;
  }
}

export default async function CasasPage() {
  const result = await loadHouses();
  return (
    <CasasClient
      initialHouses={result?.houses ?? []}
      initialTotal={result?.total ?? 0}
    />
  );
}
