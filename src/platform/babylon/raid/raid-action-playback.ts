import { RAID_HZ } from '../../../game/raid/raid-rules.ts';
import type { RaidAction } from '../../../game/raid/raid-view.ts';

type Take = { cue: RaidAction; clip: string; start: number; end: number };

/** Skills may interrupt. Auto attacks finish their take and buffer at most one follow-up. */
export class RaidActionPlayback {
  private lastId = 0;
  private lastTick = -1;
  private current?: Take;
  private pending?: Take;

  private advance(tick: number) {
    if (this.pending && tick >= this.pending.start) {
      this.current = this.pending;
      this.pending = undefined;
    }
    if (
      this.current &&
      tick >= Math.min(this.current.end, this.current.cue.cancelledAt ?? Infinity)
    )
      this.current = undefined;
  }

  update(
    actions: readonly RaidAction[],
    slot: number,
    now: number,
    resolve: (cue: RaidAction) => { clip: string; duration: number; start: number },
  ) {
    if (now < this.lastTick) {
      this.lastId = 0;
      this.current = undefined;
      this.pending = undefined;
    }
    this.lastTick = now;
    for (const cue of actions) {
      if (cue.slot !== slot || cue.id <= this.lastId || cue.tick > now) continue;
      this.lastId = cue.id;
      this.advance(cue.tick);
      if (cue.skill === 'basic' && this.current && this.current.cue.skill !== 'basic') continue;
      const { clip, duration, start } = resolve(cue);
      const ticks = (duration * RAID_HZ) / (cue.basicSpeed ?? 1);
      if (cue.skill === 'basic' && this.current) {
        const next = this.current.end;
        this.pending = { cue, clip, start: next, end: next + ticks };
        continue;
      }
      this.pending = undefined;
      this.current = { cue, clip, start, end: start + ticks };
    }
    this.advance(now);
    return this.current;
  }
}
