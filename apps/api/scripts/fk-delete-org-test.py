#!/usr/bin/env python3
"""Teste especifico da exclusao de organizacao: parseia o schema.prisma, monta o
grafo de FKs e prova que o plano de limpeza do deleteOrganization cobre TODAS
as relacoes sem cascade. Exit 1 se sobrar qualquer FK que trave o delete."""
import re, sys

SCHEMA = "packages/database/prisma/schema.prisma"
# plano do deleteOrganization: apagado explicitamente NESTA ordem, antes do delete da org
CLEANUP = ["RefundRequest", "PushToken", "Payment", "Ticket", "Order", "ReservationItem", "Reservation", "GuestListEntry"]
# vazios GARANTIDOS pela trava financeira (pedido pago/pagamento monetario/payout -> 400 antes)
GUARDED_EMPTY = {"Payout", "Checkin"}

text = open(SCHEMA).read()
models = {}
for m in re.finditer(r"^model (\w+) \{(.*?)^\}", text, re.S | re.M):
    name, body = m.group(1), m.group(2)
    rels = []
    for r in re.finditer(r"^\s*(\w+)\s+(\w+)(\?)?\s+@relation\(([^)]*)\)", body, re.M):
        target, args = r.group(2), r.group(4)
        if "fields:" not in args:
            continue
        od = re.search(r"onDelete:\s*(\w+)", args)
        rels.append((target, od.group(1) if od else ("SetNull" if r.group(3) else "Restrict")))
    models[name] = rels

def closure(seed):
    dead = set(seed)
    changed = True
    while changed:
        changed = False
        for model, rels in models.items():
            if model in dead:
                continue
            for target, od in rels:
                if target in dead and od == "Cascade":
                    dead.add(model)
                    changed = True
    return dead

stage1 = closure(CLEANUP)                      # some ANTES do delete da org
stage2 = closure({"Organization"}) - stage1    # some NO cascade final

problemas = []
for model, rels in models.items():
    for target, od in rels:
        if od in ("Cascade", "SetNull"):
            continue
        if target in stage2:
            if model in stage1 or model in GUARDED_EMPTY:
                continue  # linhas ja apagadas / garantidamente vazias
            kind = "INTRA-CASCADE" if model in stage2 else "BLOQUEIO EXTERNO"
            problemas.append(f"{kind}: {model} -> {target} ({od})")
        elif target in stage1:
            ok = (
                model in GUARDED_EMPTY
                or (model in stage1 and (model not in CLEANUP or target not in CLEANUP or CLEANUP.index(model) < CLEANUP.index(target)))
            )
            if not ok:
                problemas.append(f"LIMPEZA: {model} -> {target} ({od}) — {model} precisa sumir antes de {target}")

print(f"estagio 1 (limpeza explicita + cascatas dela): {len(stage1)} modelos")
print(f"estagio 2 (cascade da org): {len(stage2)} modelos")
if problemas:
    print("\nFALHAS:")
    for p in sorted(set(problemas)):
        print("  -", p)
    sys.exit(1)
print("OK — plano cobre todos os FKs; exclusao nao pode travar por constraint.")
