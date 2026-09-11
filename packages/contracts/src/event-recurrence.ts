export type AutomaticEventCadence = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export interface EventWallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * Converte um instante UTC para o relógio civil do timezone do evento.
 * Recorrência é uma regra de calendário local ("sexta às 22h"), não uma regra
 * sobre a data UTC armazenada no banco.
 */
export function eventWallClockParts(date: Date, timeZone: string): EventWallClockParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: date.getUTCMilliseconds(),
  };
}

function partsAsUtcMillis(parts: EventWallClockParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

/**
 * Resolve um relógio civil do evento de volta para um instante UTC. O pequeno
 * ajuste iterativo usa somente Intl (Node + browser), então API e painel não
 * dependem de bibliotecas diferentes de timezone e não divergem em DST/offset.
 */
export function eventWallClockToInstant(parts: EventWallClockParts, timeZone: string): Date {
  const desired = partsAsUtcMillis(parts);
  let guess = desired;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rendered = eventWallClockParts(new Date(guess), timeZone);
    const renderedAsUtc = partsAsUtcMillis(rendered);
    const delta = desired - renderedAsUtc;
    if (delta === 0) return new Date(guess);
    guess += delta;
  }

  return new Date(guess);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarDays(parts: EventWallClockParts, days: number): EventWallClockParts {
  const fakeUtc = new Date(partsAsUtcMillis(parts));
  fakeUtc.setUTCDate(fakeUtc.getUTCDate() + days);
  return {
    year: fakeUtc.getUTCFullYear(),
    month: fakeUtc.getUTCMonth() + 1,
    day: fakeUtc.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: parts.millisecond,
  };
}

function addCalendarMonth(parts: EventWallClockParts, anchorDay: number): EventWallClockParts {
  const monthIndex = parts.month; // 1-based atual vira índice 0-based do próximo mês.
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return {
    year,
    month,
    day: Math.min(anchorDay, daysInMonth(year, month)),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: parts.millisecond,
  };
}

function advanceWallClock(
  parts: EventWallClockParts,
  cadence: AutomaticEventCadence,
  monthlyAnchorDay: number,
): EventWallClockParts {
  if (cadence === "WEEKLY") return addCalendarDays(parts, 7);
  if (cadence === "BIWEEKLY") return addCalendarDays(parts, 14);
  return addCalendarMonth(parts, monthlyAnchorDay);
}

/**
 * Primeira ocorrência futura da série preservando dia/horário NO TIMEZONE DO
 * EVENTO. Ex.: 31/jan às 22h em São Paulo -> último dia de fev às 22h, ainda
 * que o instante UTC já pertença ao dia seguinte.
 */
export function nextAutomaticEventOccurrence(
  source: Date,
  cadence: AutomaticEventCadence,
  timeZone: string,
  nowMs = Date.now(),
): Date {
  const sourceWallClock = eventWallClockParts(source, timeZone);
  const monthlyAnchorDay = sourceWallClock.day;
  let cursor = sourceWallClock;

  for (let guard = 0; guard < 520; guard += 1) {
    cursor = advanceWallClock(cursor, cadence, monthlyAnchorDay);
    const candidate = eventWallClockToInstant(cursor, timeZone);
    if (candidate.getTime() > nowMs) return candidate;
  }

  throw new RangeError("Não foi possível calcular a próxima ocorrência futura");
}
