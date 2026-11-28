import { standardContact } from '../../../content/raid/projectile-contact.ts';
import { projectile } from '../skills/skill-effects.ts';
import type { HitRule } from '../skills/attack-rule.ts';

// Curated flight patterns use the same collision profile for player aim, bots and impact.
export function shot(hit: HitRule, angles: readonly number[] = [0], pierces = false, reach = 16) {
  return projectile({ reach, speed: 24, angles, pierces, contact: standardContact }, hit);
}
