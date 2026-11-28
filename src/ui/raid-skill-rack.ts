import { raidText as t } from '../content/locales/run-and-raid.ts';
import { heroKit } from '../game/raid/heroes/hero-id.ts';
import { raidRunnerAimKind } from '../game/raid/heroes/hero-catalog.ts';
import type { RaidView, Skill } from '../game/raid/raid-match.ts';
import type { RaidAimPad } from './raid-aim-pad.ts';
import { battleIconIndex, setSkillIcon } from './raid-skill-icon.ts';
import { raidSkillIndicator } from './raid-skill-indicator.ts';
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
    const art = element('img', b);
    art.className = 'raid-skill-art';
    art.hidden = true;
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
    return { slot, b, art, charge, name };
  });
  function update(runner: RaidView['runners'][number], aiming: Skill | null) {
    displayedRunner = runner;
    buttons.forEach(({ slot, b, art, charge, name }) => {
      setSkillIcon(
        art,
        runner.hero,
        battleIconIndex(runner.hero, slot, runner.heroView.shieldMode),
      );
      const status = raidSkillIndicator(runner, slot);
      const typeLabel = t(
        status.kind === 'pulse'
          ? 'typeInstant'
          : status.kind === 'direction'
            ? 'typeDirection'
            : status.kind === 'field' || status.kind === 'leap'
              ? 'typeGround'
              : 'typeTarget',
      );
      if (b.dataset.kind !== status.kind) {
        b.dataset.kind = status.kind;
        const digit = String(slot + 1);
        b.setAttribute(
          'aria-keyshortcuts',
          status.kind === 'pulse' ? digit : digit + ' Shift+' + digit,
        );
      }
      const skillName = t(`${heroKit(runner.hero)}${skillNames[slot]}`);
      let label = skillName;
      if (status.land) label = t('valletLand');
      else if (status.cancelActive) label = t('cancelSkill');
      else if (runner.heroView.shieldMode)
        label = t((['magnusCharge', 'magnusTaunt', 'magnusCry', 'magnusBattle'] as const)[slot]);
      if (name.textContent !== label) name.textContent = label;
      if (b.disabled !== !status.ready) b.disabled = !status.ready;
      if (b.disabled && gesture?.slot === slot) endGesture();
      if (b.disabled && aimPad.skill === slot) aimPad.close();
      b.toggleAttribute('data-cancel-active', status.cancelActive);
      b.toggleAttribute('data-cooling', status.ticks > 0);
      const angle = status.degrees + 'deg';
      if (b.style.getPropertyValue('--cooldown') !== angle)
        b.style.setProperty('--cooldown', angle);
      if (slot === 3) rack.toggleAttribute('data-rage', status.usesRage);
      if (status.usesRage) {
        rack.style.setProperty('--rage-fill', runner.rage + '%');
        b.style.setProperty(
          '--rage-fill',
          runner.heroView.ultimateRecasts ? '100%' : runner.rage + '%',
        );
      }
      if (charge.textContent !== status.value) charge.textContent = status.value;
      const title = status.cancelActive ? skillName + ' · ' + label : label + ' · ' + typeLabel;
      if (b.title !== title) b.title = title;
      const detail = status.ticks
        ? t('cooldownRemaining', { seconds: status.value })
        : status.value;
      const accessible = detail ? title + ' · ' + detail : title;
      if (b.getAttribute('aria-label') !== accessible) b.setAttribute('aria-label', accessible);
      b.classList.toggle('armed', slot === aiming);
      const pressed =
        status.kind === 'pulse' ? null : String(slot === aiming || aimPad.skill === slot);
      if (b.ariaPressed !== pressed) b.ariaPressed = pressed;
    });
  }
  return { update, endGesture };
}
