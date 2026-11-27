import { HERO_IDS, ORIGINAL_HERO_IDS, type RaidHero } from './heroes/hero-id.ts';

export function practiceRoster(hero: RaidHero): RaidHero[] {
  const start = ORIGINAL_HERO_IDS.findIndex((id) => id === hero) + 1;
  const bots = Array.from(
    { length: 3 },
    (_, offset) => ORIGINAL_HERO_IDS[(start + offset) % ORIGINAL_HERO_IDS.length]!,
  );
  return [hero, ...bots];
}

export interface DraftSeat {
  actor: number;
  hero: RaidHero | null;
  preferred?: RaidHero;
}
export interface RaidSeat extends DraftSeat {
  hero: RaidHero;
}
export const draftMessageLimit = 140;
const pickOrder = [0, 1, 3, 2];
export const pickTimeMs = 20_000;
export const readyTimeMs = 15_000;

export function pickNumber(index: number) {
  return pickOrder.indexOf(index) + 1;
}

export interface DraftClock {
  actor: number | null;
  endsAt: number;
}

/** All deadlines use the local monotonic clock. Only the room master advances turns. */
export function nextDraftClock(seats: DraftSeat[], previous: DraftClock | null, now: number) {
  if (seats.length < 2) return null;
  if (previous && seats.some((s) => s.actor === previous.actor && !s.hero)) return previous;
  const actor =
    pickOrder.map((index) => seats[index]).find((seat) => seat && !seat.hero)?.actor ?? null;
  if (previous?.actor === actor) return previous;
  return { actor, endsAt: now + (actor === null ? readyTimeMs : pickTimeMs) };
}

export function timeoutPick(seats: DraftSeat[], actor: number) {
  const preferred = seats.find((s) => s.actor === actor)?.preferred;
  if (preferred && applyPick(seats, actor, preferred)) return;
  const hero = ORIGINAL_HERO_IDS.find((id) => !seats.some((s) => s.hero === id));
  applyPick(seats, actor, hero);
}

export function applyTurnPick(
  seats: DraftSeat[],
  clock: DraftClock | null,
  actor: number,
  hero: unknown,
) {
  if (hero !== null && clock && clock.actor !== actor) return false;
  return applyPick(seats, actor, hero);
}

export function draftMessage(value: unknown): string {
  return typeof value === 'string' && value.length <= draftMessageLimit
    ? value.replace(/\s+/gu, ' ').trim()
    : '';
}

export function draftTeammates(seats: readonly DraftSeat[], actor: number) {
  const own = seats.findIndex((seat) => seat.actor === actor);
  return seats
    .filter((_, i) => own >= 0 && i !== own && i % 2 === own % 2)
    .map((seat) => seat.actor);
}
export function isHero(value: unknown): value is RaidHero {
  return HERO_IDS.some((hero) => hero === value);
}
export function isDraftPick(value: unknown): value is (typeof ORIGINAL_HERO_IDS)[number] {
  return ORIGINAL_HERO_IDS.some((hero) => hero === value);
}
export function isDraft(value: unknown): value is DraftSeat[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const claimed = new Set<RaidHero>();
  return value.every((seat, i) => {
    if (!seat || !Number.isSafeInteger(seat.actor) || seat.actor <= (i ? value[i - 1].actor : 0))
      return false;
    if (seat.preferred !== undefined && !isDraftPick(seat.preferred)) return false;
    if (seat.hero === null) return true;
    if (!isHero(seat.hero) || claimed.has(seat.hero)) return false;
    claimed.add(seat.hero);
    return true;
  });
}
export function isRaidRoster(value: unknown): value is RaidSeat[] {
  return isDraft(value) && value.length >= 2 && value.every((s) => s.hero !== null);
}

export function readDraftSnapshot(value: unknown, now: number) {
  if (!value || typeof value !== 'object' || !('seats' in value) || !isDraft(value.seats))
    return null;
  const seats = value.seats;
  if (!('turn' in value) || !('remaining' in value)) return null;
  const { turn, remaining } = value;
  if (seats.length === 1)
    return turn === null && remaining === null ? { seats, clock: null } : null;
  if (
    typeof remaining !== 'number' ||
    !Number.isFinite(remaining) ||
    remaining < 0 ||
    remaining > (turn === null ? readyTimeMs : pickTimeMs)
  )
    return null;
  if (turn !== null && typeof turn !== 'number') return null;
  if (turn === null ? !isRaidRoster(seats) : !seats.some((s) => s.actor === turn && !s.hero))
    return null;
  return { seats, clock: { actor: turn, endsAt: now + remaining } };
}
/** Authority preserves existing locks across joins, departures and lobby host changes. */
export function draftMembers(
  previous: readonly DraftSeat[],
  actors: readonly number[],
): DraftSeat[] {
  return [...actors]
    .sort((a, b) => a - b)
    .map((actor) => ({ actor, hero: null, ...previous.find((s) => s.actor === actor) }));
}
/** The room master checks the turn before accepting a claim. */
export function applyPick(seats: DraftSeat[], actor: number, hero: unknown): boolean {
  const seat = seats.find((s) => s.actor === actor);
  if (
    !seat ||
    (hero !== null &&
      (!isDraftPick(hero) || seat.hero !== null || seats.some((s) => s.hero === hero)))
  )
    return false;
  seat.hero = hero;
  return true;
}
