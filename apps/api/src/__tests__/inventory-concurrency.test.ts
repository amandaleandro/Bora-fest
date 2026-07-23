import { test } from "node:test";
import assert from "node:assert/strict";
import { InventoryService, InsufficientStockError } from "../inventory/inventory.service";
import { createFixtureEvent, cleanupFixtureEvent } from "./helpers";

test("estoque atômico: N tentativas concorrentes contra lote de capacidade C nunca vendem mais que C", async () => {
  const CAPACITY = 3;
  const ATTEMPTS = 10;
  const { organization, lot } = await createFixtureEvent({ lotCapacity: CAPACITY });

  try {
    const inventory = new InventoryService();

    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, () => inventory.tryReserve(lot.id, 1)),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof InsufficientStockError,
    ).length;

    assert.equal(succeeded, CAPACITY, `deveria reservar exatamente ${CAPACITY}, reservou ${succeeded}`);
    assert.equal(failed, ATTEMPTS - CAPACITY);

    const availability = await inventory.getAvailability(lot.id);
    assert.equal(availability?.available, 0);
    assert.equal(availability?.reserved, CAPACITY);
  } finally {
    await cleanupFixtureEvent(organization.id);
  }
});
