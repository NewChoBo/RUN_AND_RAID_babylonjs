import { stats, scatter, piercing } from '../../../content/raid/heroes/longshot.ts';
import { defineHero } from './hero-definition.ts';
import { field, projectile } from '../skills/skill-effects.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { slow } from '../raid-control.ts';
import { RAID_HZ } from '../raid-rules.ts';

export const longshot = defineHero(
  stats,
  () => ({
    onIncomingHit: (combat) => combat.self.dash?.skill === 2,
  }),
  [
    { ...projectile(scatter, { powerScale: 0.75 }), cooldownTicks: 8 * RAID_HZ },
    field(
      { powerScale: 3, control: [slow(30)] },
      {
        intervalTicks: 15,
        count: 2,
        effect: { kind: 'damageEnemies', hit: { powerScale: 1, control: [slow(30)] } },
      },
    ),
    { kind: 'direction', range: 5, travelTicks: 12, attack: noAttack },
    projectile(piercing, { powerScale: 7, piercesShield: true }, RAID_HZ),
  ],
);
