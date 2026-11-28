import { draftCatalog, hasDraftCatalog, type CatalogHero } from '../content/raid/draft-loadout.ts';
import { heroKit, type HeroKit, type RaidHero } from '../game/raid/heroes/hero-id.ts';

// Square crop in source coordinates, measured from the upper left.
type Crop = readonly [left: number, top: number, side: number];

// Each 800 px stat sheet has a 75 px face crop starting 5 px below its top.
const guideFaceLeft: Record<Exclude<CatalogHero, 'freesia'>, number> = {
  hammer: 48,
  longshot: 48,
  flare: 44,
  alice: 39,
  hof: 47,
  kali: 33,
  kaiken: 81,
  abyss: 41,
  froze: 29,
  magnus: 39,
  swift: 47,
  rildin: 34,
  jade: 68,
  theresa: 55,
  drizz: 48,
  vallet: 56,
};

// The bundled model portraits are square. These coordinates are percentages.
const portraitCrops: Record<HeroKit, Crop> = {
  hammer: [36, 36, 63],
  longshot: [22, 35, 60],
  flare: [43, 8, 22],
  alice: [31, 18, 35],
  hof: [19, 9, 62],
  kali: [24, 38, 59],
  kaiken: [25, 37, 61],
  abyss: [24, 42, 58],
  froze: [40, 6, 21],
  magnus: [35, 7, 35],
  swift: [23, 31, 61],
  rildin: [24, 36, 62],
  jade: [29, 41, 59],
  theresa: [14, 5, 24],
  drizz: [32, 3, 35],
  vallet: [16, 7, 27],
  freesia: [38, 17, 27],
  rend: [28, 32, 60],
  bastion: [24, 33, 64],
  rime: [28, 39, 60],
};

function cropImage(image: HTMLImageElement, [left, top, side]: Crop, width: number) {
  image.style.left = (-100 * left) / side + '%';
  image.style.top = (-100 * top) / side + '%';
  image.style.width = (100 * width) / side + '%';
}

export function addPickFace(card: HTMLElement, hero: RaidHero) {
  const model = document.createElement('img');
  model.alt = '';
  model.dataset.hero = hero;
  model.loading = 'lazy';
  const kit = heroKit(hero);
  if (kit === hero) {
    cropImage(model, portraitCrops[kit], 100);
    model.src = './assets/raid/portraits/' + hero + '.webp';
  } else model.src = './assets/raid/pick-faces/' + hero + '.webp';
  card.append(model);
  if (!hasDraftCatalog(hero)) return;

  const guide = document.createElement('img');
  guide.alt = '';
  guide.loading = 'lazy';
  guide.referrerPolicy = 'no-referrer';
  guide.style.opacity = '0';
  guide.onload = () => {
    model.hidden = true;
    guide.style.opacity = '1';
  };
  guide.onerror = () => guide.remove();
  if (hero === 'freesia') cropImage(guide, [77, 4, 118], 256);
  else cropImage(guide, [guideFaceLeft[hero], 5, 75], 800);
  guide.src = draftCatalog[hero].face;
  card.append(guide);
}
