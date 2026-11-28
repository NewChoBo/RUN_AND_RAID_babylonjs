import { stats, scatter, piercing } from '../../../content/raid/heroes/longshot.ts';
import { defineHero } from './hero-definition.ts';
import { field, projectile } from '../skills/skill-effects.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { slow } from '../raid-control.ts';
import { RAID_HZ } from '../raid-rules.ts';

const arrowRainHit = { powerScale: 3, control: [slow(30, 18)] };

export const longshot = defineHero(
  stats,
  () => ({
    onIncomingHit: (combat) => combat.self.dash?.skill === 2,
    onOutgoingHit: (_combat, hit) =>
      hit.skill === 1 && hit.target === 'wagon' ? Math.round(hit.amount / 2) : hit.amount,
  }),
  [
    projectile(scatter, { powerScale: 2.5 }),
    field(arrowRainHit, {
      intervalTicks: 15,
      count: 3,
      effect: { kind: 'damageEnemies', hit: arrowRainHit },
    }),
    { kind: 'direction', range: 5, travelTicks: 12, attack: noAttack },
    projectile(piercing, { powerScale: 7, piercesShield: true }, RAID_HZ),
  ],
);
