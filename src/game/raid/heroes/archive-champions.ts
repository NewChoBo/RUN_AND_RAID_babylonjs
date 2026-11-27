import { defineHero, type HeroCombat, type HeroEvents, type Hit } from './hero-definition.ts';
import { bolt, field, sweep } from '../skills/skill-effects.ts';
import { silence, slow, stagger } from '../raid-control.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { aid, barrage, rush, shot } from './archive-skills.ts';

export const flare = defineHero(
  { hp: 98, power: 10, reach: 9, cooldown: 24, radius: 4 },
  () => ({}),
  [
    shot({ powerScale: 3 }),
    sweep({ powerScale: 3, displacement: 'push' }),
    barrage({ powerScale: 2 }, { powerScale: 1 }, 3, 15),
    bolt(
      { powerScale: 6 },
      { splash: { area: { kind: 'circle', radius: 4 }, hit: { powerScale: 3 } } },
    ),
  ],
);
class Frostbite implements HeroEvents {
  readonly view = { iceCrystals: 4, guardUntil: 0 };
  readonly chilledUntil = new Map<number | 'wagon', number>();
  onCast(_c: HeroCombat, skill: number) {
    if (skill === 0) this.view.iceCrystals--;
  }
  onTimersAdvanced(c: HeroCombat) {
    if (c.tick() % 60 === 0) this.view.iceCrystals = Math.min(4, this.view.iceCrystals + 1);
  }
  onIncomingHit(c: HeroCombat, hit: Hit) {
    if (this.view.guardUntil <= c.tick() || hit.skill === undefined || hit.rule?.piercesShield)
      return false;
    this.view.guardUntil = 0;
    this.view.iceCrystals = Math.min(4, this.view.iceCrystals + 1);
    return true;
  }
  onOutgoingHit(c: HeroCombat, hit: Hit) {
    const chilled = (this.chilledUntil.get(hit.target) ?? 0) > c.tick();
    if (hit.skill !== undefined) this.chilledUntil.set(hit.target, c.tick() + 90);
    return chilled ? Math.round(hit.amount * 1.25) : hit.amount;
  }
}
export const froze = defineHero(
  { hp: 100, power: 10, reach: 3.4, cooldown: 22, radius: 6 },
  () => new Frostbite(),
  [
    {
      ...shot({ powerScale: 3, control: [slow(45)] }, [0], true),
      cooldownTicks: 15,
      available: (r) => (r.heroView.iceCrystals ?? 0) >= 1,
    },
    {
      kind: 'pulse',
      attack: noAttack,
      cooldownTicks: 25,
      available: (r) => (r.heroView.iceCrystals ?? 0) >= 2,
      apply(c, cast, state) {
        state.view.iceCrystals -= 2;
        for (const id of c.enemies(c.self, 6))
          if ((state.chilledUntil.get(id) ?? 0) > c.tick())
            c.strike(id, { powerScale: 4, control: [slow(60)] }, cast.skill);
        c.record(cast.skill, c.self, 'ground');
      },
    },
    {
      kind: 'pulse',
      attack: noAttack,
      apply(c, cast, state) {
        state.view.guardUntil = c.tick() + 90;
        c.record(cast.skill, c.self);
      },
    },
    barrage({ powerScale: 3, control: [slow(60)] }, { powerScale: 1 }, 4),
  ],
);
export const theresa = defineHero(
  { hp: 131, power: 10, reach: 3.5, cooldown: 23, radius: 3.6 },
  () => ({}),
  [
    aid(28, 0, 7),
    bolt({ powerScale: 3, control: [stagger(18)] }, { range: 8 }),
    sweep({ powerScale: 3, displacement: 'launch' }),
    barrage({ powerScale: 3 }, { powerScale: 2 }, 2, 15),
  ],
);
export const hof = defineHero(
  { hp: 115, power: 10, reach: 8, cooldown: 24, radius: 4.2 },
  () => ({}),
  [
    barrage({ powerScale: 1 }, { powerScale: 1, control: [slow(22)] }, 4, 8),
    rush({ powerScale: 3, displacement: 'push' }, 9),
    field({ powerScale: 4, control: [stagger(12)] }),
    shot({ powerScale: 3 }, [-0.15, 0, 0.15], true, 19),
  ],
);
export const vallet = defineHero(
  { hp: 103, power: 10, reach: 10, cooldown: 21, radius: 3.8 },
  () => ({}),
  [
    shot({ powerScale: 2 }, [-0.075, 0.075]),
    rush({ powerScale: 2 }, 6),
    barrage({ powerScale: 2 }, { powerScale: 1 }, 3, 9),
    shot({ powerScale: 6, piercesShield: true }, [0], true, 20),
  ],
);
export const freesia = defineHero(
  { hp: 96, power: 10, reach: 8, cooldown: 22, radius: 4 },
  () => ({}),
  [
    shot({ powerScale: 2, control: [slow(48)] }, [-0.1, 0.1]),
    aid(20, 12),
    field(
      { powerScale: 2 },
      { count: 3, intervalTicks: 12, effect: { kind: 'healAllies', powerScale: 1 } },
    ),
    bolt({ powerScale: 6, control: [silence(32)] }),
  ],
);
