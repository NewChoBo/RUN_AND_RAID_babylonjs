import { raidText as t } from '../content/locales/run-and-raid.ts';
import { heroKit } from '../game/raid/heroes/hero-id.ts';
import { canUseRaidSkill, raidRunnerAimKind, raidSkill } from '../game/raid/heroes/hero-catalog.ts';
import { RAID_HZ, type RaidView, type Skill } from '../game/raid/raid-match.ts';
import type { RaidAimPad } from './raid-aim-pad.ts';
import { battleIconIndex, setSkillIcon } from './raid-skill-icon.ts';
import { button, element } from './elements.ts';
const skills = ['pulse', 'bolt', 'field', 'fury'] as const;
const skillNames = ['Pulse', 'Bolt', 'Field', 'Fury'] as const;
interface SkillActions {
  clearPreview(): void;
  repeatCast(slot: Skill): void;
  skill(slot: Skill): void;
  beginPadAim(): void;
}
export function createSkillRack(deck: HTMLElement, aimPad: RaidAimPad, actions: SkillActions) {
  const rack = element('div', deck);
  rack.className = 'raid-skills';

  let gesture: {
    id: number;
    slot: Skill;
    x: number;
    y: number;
    dragged: boolean;
    button: HTMLButtonElement;
  } | null = null;
  function endGesture() {
    const current = gesture;
    gesture = null;
    if (!current) return;
    if (current.button.hasPointerCapture(current.id))
      current.button.releasePointerCapture(current.id);
    actions.clearPreview();
  }
  let displayedRunner: RaidView['runners'][number] | undefined;
  const buttons = skills.map((key, i) => {
    const slot = i as Skill;
    const b = button(rack, '');
    b.dataset.skill = key;
    b.setAttribute('aria-keyshortcuts', String(i + 1));
    const art = element('img', b);
    art.className = 'raid-skill-art';
    art.hidden = true;
    const meta = element('span', b);
    meta.className = 'raid-skill-meta';
    meta.setAttribute('aria-hidden', 'true');
    const glyph = element('i', meta);
    const type = element('b', meta);
    const charge = element('small', b);
    const name = element('span', b, t(key));
    name.className = 'raid-skill-name';
    b.onpointerdown = (e) => {
      if (gesture || aimPad.skill !== null || e.button !== 0 || b.disabled) return;
      e.preventDefault();
      gesture = { id: e.pointerId, slot, x: e.clientX, y: e.clientY, dragged: false, button: b };
      b.setPointerCapture(e.pointerId);
    };
    function track(e: PointerEvent) {
      if (!gesture || gesture.id !== e.pointerId || gesture.slot !== slot) return;
      if (Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 12) gesture.dragged = true;
    }
    b.onpointermove = track;
    b.onpointerup = (e) => {
      if (gesture?.id !== e.pointerId || gesture.slot !== slot) return;
      track(e);
      const dragged = gesture.dragged;
      endGesture();
      if (b.disabled) return;
      if (!b.contains(document.elementFromPoint(e.clientX, e.clientY))) {
        actions.repeatCast(slot);
        return;
      }
      if (dragged || !displayedRunner) return;
      const kind = raidRunnerAimKind(displayedRunner, slot);
      if (kind === 'pulse') {
        actions.skill(slot);
        return;
      }
      actions.beginPadAim();
      aimPad.open(slot, name.textContent ?? '', kind);
    };
    b.onpointercancel = b.onlostpointercapture = (e) => {
      if (gesture?.id === e.pointerId) endGesture();
    };
    // Keyboard and assistive activations have no preceding pointer sequence.
    b.onclick = (e) => {
      if (e.detail === 0 && !gesture) actions.skill(slot);
    };
    return { b, art, charge, name, glyph, type };
  });
  function update(runner: RaidView['runners'][number], aiming: Skill | null) {
    displayedRunner = runner;
    buttons.forEach(({ b, art, charge, name, glyph, type }, i) => {
      setSkillIcon(
        art,
        runner.hero,
        battleIconIndex(runner.hero, i as Skill, runner.heroView.shieldMode),
      );
      const rule = raidSkill(runner.hero, i as Skill);
      const instant = rule.kind === 'pulse';
      const typeLabel = t(
        instant
          ? 'typeInstant'
          : rule.kind === 'direction'
            ? 'typeDirection'
            : rule.kind === 'field' || rule.kind === 'leap'
              ? 'typeGround'
              : 'typeTarget',
      );
      b.dataset.kind = rule.kind;
      if (type.textContent !== typeLabel) {
        glyph.textContent = instant ? '✴' : '◎';
        type.textContent = typeLabel;
      }
      const recastMoon = runner.dash?.skill === i && instant && !!rule.recastDuringDash;
      const canLand = i === 2 && !!runner.heroView.escapeTicks;
      name.textContent = canLand
        ? t('valletLand')
        : recastMoon
          ? t('moonFinish')
          : t(`${heroKit(runner.hero)}${skillNames[i]!}`);
      if (runner.heroView.shieldMode)
        name.textContent = t(
          (['magnusCharge', 'magnusTaunt', 'magnusCry', 'magnusBattle'] as const)[i]!,
        );
      const cd = Math.ceil(runner.cooldowns[i]! / RAID_HZ);
      b.disabled = !canUseRaidSkill(runner, i as Skill);
      if (b.disabled && gesture?.slot === i) endGesture();
      if (b.disabled && aimPad.skill === i) aimPad.close();
      if (i === 3 && !rule.noRageCost) {
        const recasts = runner.heroView.ultimateRecasts;
        rack.toggleAttribute('data-rage', true);
        rack.style.setProperty('--rage-fill', runner.rage + '%');
        b.style.setProperty('--rage-fill', recasts ? '100%' : runner.rage + '%');
        charge.textContent = recasts
          ? t('bladeCharges', { count: recasts }) + (cd ? ' · ' + cd + 's' : '')
          : Math.floor(runner.rage) + '%';
      } else {
        if (i === 3) rack.removeAttribute('data-rage');
        const fraction = canLand
          ? 0
          : runner.cooldowns[i]! / Math.max(1, runner.cooldownDurations[i]!);
        b.style.setProperty('--cooldown', Math.round(fraction * 360) + 'deg');
        const slashes = i === 0 ? (runner.heroView.slashes ?? 0) : 0;
        charge.textContent =
          recastMoon || canLand ? '' : slashes ? 4 - slashes + '/4' : cd ? cd + 's' : '';
      }
      b.title = [name.textContent, typeLabel].join(' · ');
      b.setAttribute(
        'aria-label',
        [name.textContent, typeLabel, charge.textContent].filter(Boolean).join(' · '),
      );
      b.classList.toggle('armed', i === aiming);
    });
  }
  return { update, endGesture };
}
