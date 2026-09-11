"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HouseCard } from "../components/HouseCard";
import { housesApi, type HouseListItem } from "../lib/houses-api";

export function HomeHouses({ initialHouses }: { initialHouses: HouseListItem[] }) {
  const [followed, setFollowed] = useState<HouseListItem[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("bf.token");
    if (!token) return;
    housesApi.followed(token).then(setFollowed).catch(() => setFollowed([]));
  }, []);

  if (initialHouses.length === 0 && followed.length === 0) return null;

  const followedIds = new Set(followed.map((house) => house.id));
  const discover = initialHouses.filter((house) => !followedIds.has(house.id)).slice(0, 8);

  return (
    <main className="px-5 pb-2 lg:mx-auto lg:max-w-6xl lg:px-6">
      {followed.length > 0 ? (
        <section className="mt-7 lg:mt-10">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[.09em] text-primary">Sua rede</p>
              <h2 className="mt-0.5 text-[17px] font-extrabold text-ink lg:text-[21px]">Casas que você segue</h2>
            </div>
            <Link href="/casas" className="text-[12px] font-extrabold text-primary">Ver todas</Link>
          </div>
          <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
            {followed.slice(0, 4).map((house) => (
              <HouseCard key={house.id} house={house} compact />
            ))}
          </div>
        </section>
      ) : null}

      {discover.length > 0 ? (
        <section className="mt-7 lg:mt-10">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[.09em] text-primary">BoraFest Casa</p>
              <h2 className="mt-0.5 text-[17px] font-extrabold text-ink lg:text-[21px]">Casas com agenda ativa</h2>
            </div>
            <Link href="/casas" className="text-[12px] font-extrabold text-primary">Descobrir Casas</Link>
          </div>
          <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
            {discover.slice(0, 4).map((house) => (
              <HouseCard key={house.id} house={house} compact />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
