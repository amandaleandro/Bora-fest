import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { duplicateEventSchema } from "@borafest/contracts";

describe("N3 — contrato de recorrência", () => {
  it("rejeita startsAt manual quando a cadência é automática", () => {
    const result = duplicateEventSchema.safeParse({
      cadence: "WEEKLY",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.equal(result.success, false);
  });

  it("rejeita endsAt manual quando a cadência é automática", () => {
    const result = duplicateEventSchema.safeParse({
      cadence: "MONTHLY",
      endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    });
    assert.equal(result.success, false);
  });

  it("aceita datas manuais no modo CUSTOM e aplica defaults de cópia", () => {
    const startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const result = duplicateEventSchema.parse({ cadence: "CUSTOM", startsAt });
    assert.equal(result.startsAt, startsAt);
    assert.equal(result.copyTickets, true);
    assert.equal(result.copyAddOns, true);
    assert.equal(result.copySalesPartners, true);
    assert.equal(result.copyCheckinPoints, true);
    assert.equal(result.copyMarketing, false);
  });
});
