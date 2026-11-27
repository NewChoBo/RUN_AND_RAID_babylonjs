import icons from '../content/raid/skill-icons.json' with { type: 'json' };
import { heroKit, type RaidHero } from '../game/raid/heroes/hero-id.ts';
import type { Skill } from '../game/raid/raid-match.ts';

const sources: Partial<Record<RaidHero, readonly string[]>> = icons;

// The restoration moved some abilities. Numbers are the cafe's filenames (0 is passive).
const adaptedSlots: Partial<Record<RaidHero, readonly [number, number, number, number]>> = {
  abyss: [3, 1, 2, 4],
  hof: [2, 0, 4, 1],
  vallet: [1, 3, 2, 4],
};

export function battleIconIndex(hero: RaidHero, slot: Skill, shieldMode = false) {
  hero = heroKit(hero);
  // The fourth button names the mode the player will enter.
  if (hero === 'magnus') return slot === 3 ? (shieldMode ? 4 : 8) : slot + (shieldMode ? 5 : 1);
  return adaptedSlots[hero]?.[slot] ?? slot + 1;
}

export function setSkillIcon(image: HTMLImageElement, hero: RaidHero, index: number) {
  hero = heroKit(hero);
  const source = sources[hero]?.[index];
  if (image.dataset.source === (source ?? '')) return;
  image.hidden = true;
  image.alt = '';
  image.draggable = false;
  image.referrerPolicy = 'no-referrer';
  image.onload = null;
  image.onerror = null;
  image.dataset.source = source ?? '';
  if (!source) {
    image.removeAttribute('src');
    return;
  }
  image.onload = () => {
    image.hidden = false;
  };
  if (import.meta.env.DEV) {
    image.onerror = () => {
      image.onerror = null;
      image.src = source;
    };
    image.src = './player-assets/skill-icons/' + hero + index + '.png';
  } else {
    image.src = source;
  }
}

export function skillLabel(hero: RaidHero, index: number, text: string) {
  const label = document.createElement('span');
  label.className = 'raid-pick-skill';
  const image = document.createElement('img');
  image.width = image.height = 24;
  setSkillIcon(image, hero, index);
  label.append(image, text);
  return label;
}
