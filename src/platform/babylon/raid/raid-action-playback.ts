import { raidActionTicks } from '../../../game/raid/raid-facing.ts';
import { RAID_HZ } from '../../../game/raid/raid-rules.ts';
import type { RaidAction } from '../../../game/raid/raid-view.ts';

/** Keep the current take beyond the network action history. New casts can interrupt recovery. */
export class RaidActionPlayback {
  private lastId = 0;
  private lastTick = -1;
  private current?: { cue: RaidAction; clip: string; start: number; end: number };

  update(
    actions: readonly RaidAction[],
    slot: number,
    now: number,
    resolve: (cue: RaidAction) => { clip: string; duration: number; start: number },
  ) {
    if (now < this.lastTick) {
      this.lastId = 0;
      this.current = undefined;
    }
    this.lastTick = now;
    for (const cue of actions) {
      if (cue.slot !== slot || cue.id <= this.lastId || cue.tick > now) continue;
      this.lastId = cue.id;
      const previous = this.current;
      if (
        cue.skill === 'basic' &&
        previous &&
        previous.cue.skill !== 'basic' &&
        cue.tick < Math.min(previous.end, previous.cue.tick + raidActionTicks(previous.cue))
      )
        continue;
      const { clip, duration, start } = resolve(cue);
      this.current = { cue, clip, start, end: start + duration * RAID_HZ };
    }
    if (this.current && now >= this.current.end) this.current = undefined;
    return this.current;
  }
}
