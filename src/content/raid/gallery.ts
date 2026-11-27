import illustrations from './illustrations.json' with { type: 'json' };
import { getLocale } from '../locales/locale.ts';
export { illustrations };
const names: Record<string, string> = {
  hammer: '해머',
  abyss: '어비스',
  longshot: '롱샷',
  jade: '제이드',
  rildin: '릴딘',
  kaiken: '카이켄',
  swift: '스위프트',
  kali: '칼리',
  alice: '앨리스',
  flare: '플레어',
  freesia: '프리지아',
  froze: '프로즈',
  magnus: '매그너스',
  theresa: '테레사',
  drizz: '드리즈',
  vallet: '발렛',
  hof: '호프',
};
export function characterName(id: string) {
  return names[id] ?? id;
}
const englishNames = new Map(
  Object.entries(names).map(([id, korean]) => [korean, id.charAt(0).toUpperCase() + id.slice(1)]),
);
export function characterLabel(sourceName: string) {
  if (getLocale() === 'ko') return sourceName;
  return sourceName
    .split('·')
    .map((name) => englishNames.get(name) ?? name.charAt(0).toUpperCase() + name.slice(1))
    .join(' · ');
}
export function characterArt(id: string) {
  const hero = characterName(id);
  return (
    illustrations.find((i) => i.hero === hero && i.caption === hero + ' 기본')?.image ??
    './assets/raid/portraits/' + id + '.webp'
  );
}
