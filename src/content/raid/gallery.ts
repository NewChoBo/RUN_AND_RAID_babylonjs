import illustrations from './illustrations.json' with { type: 'json' };
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
export function characterArt(id: string) {
  const hero = characterName(id);
  return (
    illustrations.find((i) => i.hero === hero && i.caption === hero + ' 기본')?.image ??
    './assets/raid/portraits/' + id + '.webp'
  );
}
