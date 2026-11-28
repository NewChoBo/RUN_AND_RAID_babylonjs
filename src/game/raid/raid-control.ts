interface ActiveSlow {
  readonly percent: number;
  ticks: number;
  delay: number;
}
export interface RaidControl {
  // Strongest first. Weaker effects continue counting down while covered.
  slows: ActiveSlow[];
  silenced: number;
  stunned: number;
  staggered: number;
  staggerGuard: number;
}
export type CrowdControlEffect =
  | {
      readonly kind: 'slow';
      readonly ticks: number;
      readonly percent: number;
      readonly delay: number;
    }
  | { readonly kind: 'silence' | 'stagger' | 'stun'; readonly ticks: number };

export const slow = (ticks: number, percent = 45, delay = 0): CrowdControlEffect => ({
  kind: 'slow',
  ticks,
  percent,
  delay,
});
export const silence = (ticks: number): CrowdControlEffect => ({ kind: 'silence', ticks });
export const stagger = (ticks: number): CrowdControlEffect => ({ kind: 'stagger', ticks });
export const stun = (ticks: number): CrowdControlEffect => ({ kind: 'stun', ticks });

export function actionLocked(
  runner: Pick<RaidControl, 'staggered' | 'stunned'> & { readonly launchDuration: number },
) {
  return !!(runner.staggered || runner.stunned || runner.launchDuration);
}
export const activeSlow = (runner: Pick<RaidControl, 'slows'>) =>
  runner.slows.find((s) => s.delay === 0);
export function advanceSlows(victim: RaidControl) {
  for (let i = victim.slows.length - 1; i >= 0; i--) {
    const slow = victim.slows[i]!;
    if (slow.delay) slow.delay--;
    else if (--slow.ticks === 0) victim.slows.splice(i, 1);
  }
}
export function applyCrowdControl(victim: RaidControl, effects: readonly CrowdControlEffect[]) {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'slow': {
        const existing = victim.slows.find(
          (s) => s.percent === effect.percent && s.delay === effect.delay,
        );
        if (existing) existing.ticks = Math.max(existing.ticks, effect.ticks);
        else {
          victim.slows.push({ percent: effect.percent, ticks: effect.ticks, delay: effect.delay });
          victim.slows.sort((a, b) => b.percent - a.percent);
        }
        break;
      }
      case 'silence':
        victim.silenced = Math.max(victim.silenced, effect.ticks);
        break;
      case 'stun':
        victim.stunned = Math.max(victim.stunned, effect.ticks);
        break;
      case 'stagger':
        if (!victim.staggerGuard) {
          victim.staggered = effect.ticks;
          victim.staggerGuard = effect.ticks + 24;
        }
        break;
    }
  }
}
