// The four lobby seats alternate teams. Pick order uses lobby indices; simulation slots group teammates.
export const pickOrder: readonly number[] = [0, 1, 3, 2];
export const seatOrder = [0, 2, 1, 3] as const;
export const RAID_ROOM_CAPACITY = seatOrder.length;
export const minimumOnlineSeats = 2;
export const pickTimeMs = 20_000;
export const readyTimeMs = 15_000;
export const startDelayMs = 3_000;
