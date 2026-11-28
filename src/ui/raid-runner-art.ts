import type { RaidHero } from '../game/raid/heroes/hero-id.ts';
import type { battleOutfit } from '../content/raid/battle-outfits.ts';
import { characterArt } from '../content/raid/gallery.ts';

export function setRunnerArt(
  image: HTMLImageElement,
  hero: RaidHero,
  thumbnail = false,
  outfit?: ReturnType<typeof battleOutfit>,
) {
  const source = outfit?.image ?? characterArt(hero);
  if (image.dataset.hero === hero && image.dataset.art === source) return;
  image.dataset.art = source;
  image.dataset.hero = hero;
  image.referrerPolicy = 'no-referrer';
  const fallback = outfit?.portrait ?? './assets/raid/portraits/' + hero + '.webp';
  image.style.background =
    source === fallback ? '' : `url("${fallback}") center / contain no-repeat`;
  image.onload = () => {
    image.style.background = '';
  };
  image.onerror =
    source === fallback
      ? null
      : () => {
          image.onerror = null;
          image.src = fallback;
        };
  if (thumbnail && source.startsWith('https://cafeptthumb-phinf.pstatic.net/')) {
    const url = new URL(source);
    url.searchParams.set('type', 'w220');
    image.src = url.href;
  } else image.src = source;
}
