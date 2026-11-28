import { setButtonIcon } from './icons.ts';
import { RAID_SHORTCUTS, RAID_TOUCH } from '../content/raid/controls.ts';
import { keyLabel } from '../platform/browser/preferences.ts';
import { addPickFace } from './raid-pick-face.ts';
import { raidText as t } from '../content/locales/run-and-raid.ts';
import { enemySlots, type RaidPing, type RaidView, type Team } from '../game/raid/raid-view.ts';

const directions = ['advance', 'retreat', 'enemy1', 'enemy2'] as const;
const arrows: Record<string, RaidPing> = {
  ArrowUp: 'advance',
  ArrowDown: 'retreat',
  ArrowLeft: 'enemy1',
  ArrowRight: 'enemy2',
};

export function createRaidPing(parent: HTMLElement, send: (intent: RaidPing) => void) {
  const pad = document.createElement('div');
  pad.className = 'raid-ping';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'raid-ping-trigger';
  trigger.textContent = '!';
  const shortcut = keyLabel(RAID_SHORTCUTS.ping);
  trigger.title = t('pingHelp', { key: shortcut });
  trigger.setAttribute('aria-keyshortcuts', shortcut);
  trigger.setAttribute('aria-label', t('pingTeam'));
  trigger.setAttribute('aria-description', trigger.title);
  const choices = document.createElement('div');
  choices.className = 'raid-ping-choices';
  choices.id = 'raid-ping-choices';
  choices.hidden = true;
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', t('pingTeam'));
  trigger.setAttribute('aria-controls', choices.id);
  trigger.setAttribute('aria-expanded', 'false');
  const entries = directions.map((intent) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.ping = intent;
    button.setAttribute('aria-label', t(intent));
    button.title = t(intent);
    const portrait = document.createElement('span');
    if (intent === 'enemy1' || intent === 'enemy2') {
      portrait.className = 'raid-ping-face';
      portrait.setAttribute('aria-hidden', 'true');
      button.append(portrait);
    } else setButtonIcon(button, intent === 'advance' ? 'up' : 'down', t(intent));
    button.onclick = () => {
      if (contact || choices.hidden || button.disabled) return;
      send(intent);
      close();
      trigger.focus({ preventScroll: true });
    };
    choices.append(button);
    return { intent, button, portrait };
  });
  pad.append(trigger, choices);
  parent.append(pad);
  let contact: { id: number; x: number; y: number } | null = null;
  let selected: RaidPing | undefined;
  function open() {
    choices.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }
  function close() {
    const id = contact?.id;
    contact = null;
    if (id !== undefined && trigger.hasPointerCapture(id)) trigger.releasePointerCapture(id);
    selected = undefined;
    delete pad.dataset.selected;
    choices.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
  function track(e: PointerEvent) {
    if (!contact || contact.id !== e.pointerId) return;
    const dx = e.clientX - contact.x,
      dy = e.clientY - contact.y;
    if (Math.hypot(dx, dy) < RAID_TOUCH.pingDragThresholdPx) selected = undefined;
    else if (Math.abs(dx) > Math.abs(dy)) selected = dx < 0 ? 'enemy1' : 'enemy2';
    else selected = dy < 0 ? 'advance' : 'retreat';
    if (selected) pad.dataset.selected = selected;
    else delete pad.dataset.selected;
  }
  trigger.onpointerdown = (e) => {
    if (e.button !== 0 || contact) return;
    e.preventDefault();
    contact = { id: e.pointerId, x: e.clientX, y: e.clientY };
    trigger.setPointerCapture(e.pointerId);
    open();
  };
  trigger.onpointermove = track;
  trigger.onpointerup = (e) => {
    if (contact?.id !== e.pointerId) return;
    track(e);
    const choice = entries.find((entry) => entry.intent === selected);
    close();
    if (choice && !choice.button.disabled) send(choice.intent);
  };
  trigger.onpointercancel = trigger.onlostpointercapture = (e) => {
    if (contact?.id === e.pointerId) close();
  };
  function toggleKeyboardMenu() {
    if (trigger.disabled || contact) return;
    if (!choices.hidden) {
      close();
      trigger.focus({ preventScroll: true });
      return;
    }
    open();
    entries[0]!.button.focus();
  }
  trigger.onclick = (e) => {
    if (e.detail === 0) toggleKeyboardMenu();
  };
  pad.onkeydown = (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.stopPropagation();
      return;
    }
    if (choices.hidden) return;
    const choice = entries.find((entry) => entry.intent === arrows[e.key]);
    if (choice || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (choice) choice.button.focus();
      else {
        close();
        trigger.focus();
      }
    }
  };
  pad.addEventListener('focusout', (e) => {
    if (!contact && !pad.contains(e.relatedTarget as Node | null)) close();
  });
  return {
    close,
    toggleKeyboardMenu,
    update(view: RaidView, team: Team, disabled: boolean) {
      if (disabled && !choices.hidden) close();
      trigger.disabled = disabled;
      for (const { intent, button, portrait } of entries) {
        if (intent !== 'enemy1' && intent !== 'enemy2') continue;
        const enemy = view.runners[enemySlots[team][intent === 'enemy1' ? 0 : 1]]!;
        button.disabled = enemy.respawn > 0;
        if (portrait.dataset.hero === enemy.hero) continue;
        portrait.dataset.hero = enemy.hero;
        portrait.replaceChildren();
        addPickFace(portrait, enemy.hero);
        button.title = t(intent) + ' · ' + t(enemy.hero);
        button.setAttribute('aria-label', button.title);
      }
    },
  };
}
