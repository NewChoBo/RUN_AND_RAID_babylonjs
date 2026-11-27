import { battleOutfits } from '../content/raid/battle-outfits.ts';
import { uiText } from '../content/locales/ui.ts';
import type { RaidHero } from '../game/raid/heroes/hero-id.ts';

export function createBattleOutfitPicker(change: () => void) {
  const field = document.createElement('label');
  field.className = 'battle-outfit';
  const select = document.createElement('select');
  field.append(uiText('battleModel'), select);
  const remembered = new Map<RaidHero, string>();
  let current: RaidHero | undefined;
  select.onchange = () => {
    if (current) remembered.set(current, select.value);
    change();
  };
  return {
    field,
    value: () => select.value || undefined,
    show(hero: RaidHero, locked: boolean, outfit?: string) {
      if (hero !== current) {
        current = hero;
        select.replaceChildren(new Option(uiText('defaultOutfit'), ''));
        const common = document.createElement('optgroup');
        common.label = uiText('baseModels');
        for (const item of battleOutfits) {
          if (item.group !== 'base' && (item.group !== hero || item.skin === 'default')) continue;
          const option = new Option(item.skin.replaceAll('#', ' · '), item.id);
          (item.group === 'base' ? common : select).append(option);
        }
        select.append(common);
      }
      if (locked) remembered.set(hero, outfit ?? '');
      select.value = remembered.get(hero) ?? '';
      select.disabled = locked;
    },
  };
}
