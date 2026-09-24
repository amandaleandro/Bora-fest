import { prisma } from "./index";

const VALID_UFS = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

function normalize(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function main() {
  const now = new Date();
  const excludedSlugs = (process.env.PUBLIC_CATALOG_EXCLUDED_ORG_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);

  const [expiredPublished, events, organizations] = await Promise.all([
    prisma.event.findMany({
      where: {
        status: "PUBLISHED",
        endsAt: { lte: now },
      },
      orderBy: { endsAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        startsAt: true,
        endsAt: true,
        organization: { select: { id: true, name: true, displayName: true, slug: true } },
        venue: { select: { name: true, address: true, city: true, state: true } },
      },
    }),
    prisma.event.findMany({
      where: { status: { in: ["DRAFT", "PUBLISHED", "SALES_PAUSED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        startsAt: true,
        endsAt: true,
        bannerUrl: true,
        category: true,
        organization: { select: { id: true, name: true, displayName: true, slug: true } },
        venue: { select: { name: true, address: true, city: true, state: true } },
        ticketTypes: {
          select: {
            lots: {
              select: {
                id: true,
                name: true,
                status: true,
                pdvOnly: true,
                capacity: true,
                soldCount: true,
                reservedCount: true,
              },
            },
          },
        },
      },
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        displayName: true,
        slug: true,
        status: true,
        _count: { select: { events: true } },
      },
    }),
  ]);

  const dataIssues = events.flatMap((event) => {
    const issues: string[] = [];
    const venue = event.venue;
    if (event.endsAt <= event.startsAt) issues.push("END_BEFORE_START");
    if (venue) {
      if (!normalize(venue.name)) issues.push("VENUE_NAME_EMPTY");
      if (!normalize(venue.city)) issues.push("VENUE_CITY_EMPTY");
      const uf = normalize(venue.state).toUpperCase();
      if (!VALID_UFS.has(uf)) issues.push("VENUE_UF_INVALID");
    }
    if (event.status === "PUBLISHED" && !event.bannerUrl) issues.push("PUBLISHED_WITHOUT_BANNER");
    if (event.status === "PUBLISHED" && !event.category) issues.push("PUBLISHED_WITHOUT_CATEGORY");
    const publicLots = event.ticketTypes
      .flatMap((type) => type.lots)
      .filter((lot) => lot.status === "ACTIVE" && !lot.pdvOnly);
    if (event.status === "PUBLISHED" && publicLots.length === 0) issues.push("PUBLISHED_WITHOUT_ONLINE_LOT");

    return issues.length
      ? [{
          eventId: event.id,
          title: event.title,
          slug: event.slug,
          status: event.status,
          organization: event.organization.displayName ?? event.organization.name,
          organizationSlug: event.organization.slug,
          issues,
          venue,
        }]
      : [];
  });

  const testLikeOrganizations = organizations.filter((org) =>
    /(^|[-_\s])(test|teste|demo|homolog|sandbox|staging)([-_\s]|$)/i.test(
      [org.name, org.displayName, org.slug].filter(Boolean).join(" "),
    ),
  );

  const notExcludedYet = testLikeOrganizations.filter((org) => !excludedSlugs.includes(org.slug));

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    summary: {
      expiredPublished: expiredPublished.length,
      eventsWithDataIssues: dataIssues.length,
      testLikeOrganizationsNotExcluded: notExcludedYet.length,
    },
    expiredPublished,
    eventsWithDataIssues: dataIssues,
    possibleHomologationOrganizations: notExcludedYet,
    configuredExcludedOrganizationSlugs: excludedSlugs,
    notes: [
      "Este script NÃO altera registros.",
      "A detecção de possível homologação é apenas sugestão operacional por nome/slug; nunca é aplicada automaticamente ao catálogo.",
      "Revise cada item antes de qualquer correção em produção.",
    ],
  };

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main()
  .catch((error) => {
    console.error("Falha na auditoria de catálogo:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
