import {
  stats,
  scatter,
  piercing,
  volleyFrames,
  airArrowFlight,
} from '../../../content/raid/heroes/longshot.ts';
import { raidGroundPointAfter } from '../runner-motion.ts';
import { defineHero, type AirArrow, type Hit, type HeroCombat } from './hero-definition.ts';
import { field, projectile } from '../skills/skill-effects.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { slow } from '../raid-control.ts';
import { RAID_HZ } from '../raid-rules.ts';

const arrowRainHit = { powerScale: 3, control: [slow(30, 18)] };

class RollingShot {
  readonly view = { airArrows: [] as AirArrow[] };
  onBeforeHits(c: HeroCombat) {
    const arrows = this.view.airArrows;
    const r = c.self;
    if (r.dash?.aerialVolley && volleyFrames.includes(r.dash.elapsed))
      arrows.push({ x: r.x, z: r.z, height: 1 + c.height(r), tick: c.tick() });
    for (const arrow of arrows) {
      const age = c.tick() - arrow.tick;
      if (age === airArrowFlight)
        for (const enemy of c.enemies(raidGroundPointAfter(arrow, age), 3))
          c.strike(enemy, { powerScale: 1.625 }, 2);
    }
    while (arrows.length && c.tick() - arrows[0]!.tick > airArrowFlight) arrows.shift();
  }
  onOutgoingHit(_combat: HeroCombat, hit: Hit) {
    return hit.skill === 1 && hit.target === 'wagon' ? Math.round(hit.amount / 2) : hit.amount;
  }
}
export const longshot = defineHero(stats, () => new RollingShot(), [
  projectile(scatter, { powerScale: 2.5 }),
  field(arrowRainHit, {
    intervalTicks: 15,
    count: 3,
    effect: { kind: 'damageEnemies', hit: arrowRainHit },
  }),
  { kind: 'direction', range: 5, travelTicks: 45, aerialVolley: true, attack: noAttack },
  projectile(piercing, { powerScale: 7, piercesShield: true }, RAID_HZ),
]);
