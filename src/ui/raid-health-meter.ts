import { HEROES } from '../game/raid/heroes/hero-catalog.ts';
import type { RaidRunner } from '../game/raid/raid-view.ts';

// Original footage shows divisions. The unit here uses restoration HP.
export const HP_PER_SEGMENT = 25;
export function healthMeter(runner: RaidRunner, tick: number) {
  const max = HEROES[runner.hero].hp;
  const alive = !runner.respawn && runner.hp > 0;
  return {
    hp: alive ? runner.hp : 0,
    max,
    barrier: alive && runner.barrier && runner.barrier.until > tick ? runner.barrier.amount : 0,
    reducedDamage: alive && runner.shield > 0,
    guarding: alive && (runner.heroView.guardUntil ?? 0) > tick,
  };
}
type Vitals = ReturnType<typeof healthMeter>;
interface MeterContext {
  fillStyle: unknown;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}
// Both renderers use the same scale. A separate shield strip stays visible even at full HP.
export function healthMeterPainter(ctx: MeterContext, width: number, height: number) {
  let previous: Vitals | undefined;
  let wasAlly: boolean | undefined;
  return (v: Vitals, ally: boolean) => {
    if (
      previous &&
      wasAlly === ally &&
      previous.hp === v.hp &&
      previous.max === v.max &&
      previous.barrier === v.barrier &&
      previous.reducedDamage === v.reducedDamage &&
      previous.guarding === v.guarding
    )
      return false;
    previous = v;
    wasAlly = ally;
    ctx.clearRect(0, 0, width, height);
    const pad = 2;
    const inner = width - 2 * pad;
    const shieldHeight = Math.round(height * 0.32);
    const barTop = shieldHeight;
    const mainHeight = height - barTop;
    ctx.fillStyle = '#191c22';
    ctx.fillRect(0, barTop, width, mainHeight);
    ctx.fillStyle = '#363e46';
    ctx.fillRect(pad, barTop + pad, inner, mainHeight - 2 * pad);
    ctx.fillStyle = ally ? '#8fd34d' : '#ed644d';
    ctx.fillRect(pad, barTop + pad, (inner * v.hp) / v.max, mainHeight - 2 * pad);
    if (v.barrier > 0) {
      const length = Math.max(1, Math.round(inner * Math.min(1, v.barrier / v.max)));
      ctx.fillStyle = '#14383e';
      ctx.fillRect(0, 0, length + 2 * pad, shieldHeight);
      ctx.fillStyle = '#77ecf3';
      ctx.fillRect(pad, pad, length, shieldHeight - pad);
    }
    ctx.fillStyle = 'rgba(18,23,27,0.78)';
    for (let hp = HP_PER_SEGMENT; hp < v.max; hp += HP_PER_SEGMENT)
      ctx.fillRect(pad + Math.round((inner * hp) / v.max), barTop + pad, 2, mainHeight - 2 * pad);
    if (v.reducedDamage) {
      ctx.fillStyle = '#f9cb73';
      ctx.fillRect(0, height - pad, width, pad);
    }
    if (v.guarding) {
      ctx.fillStyle = '#d3aeff';
      ctx.fillRect(0, v.reducedDamage ? height - 2 * pad : height - pad, width, pad);
    }
    return true;
  };
}
