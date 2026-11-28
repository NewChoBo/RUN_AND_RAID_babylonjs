import { button, element } from './elements.ts';
import { createRaidScoreboard } from './raid-scoreboard.ts';
import { createRaidMenu } from './raid-menu.ts';
import type { RaidHudSettings } from '../platform/browser/preferences.ts';
import { createRaidResult } from './raid-result.ts';
import { createSkillRack } from './raid-skill-rack.ts';
import { healthMeter, healthMeterPainter } from './raid-health-meter.ts';
import { activeSlow } from '../game/raid/raid-control.ts';
import { canPressJump, JET_CAPACITY } from '../game/raid/air-movement.ts';
import { raidRageDamageToFull } from '../content/raid/rage.ts';
import { raidText as t } from '../content/locales/run-and-raid.ts';
import { RAID_HZ, type RaidView, type Skill } from '../game/raid/raid-match.ts';
import { createRaidPing } from './raid-ping.ts';
import type { RaidPing } from '../game/raid/raid-view.ts';
import { createTouchPad } from './touch-pad.ts';
import { createRaidCombatNumbers } from './raid-combat-numbers.ts';
import {
  RaidAimPad,
  aimFeedback,
  type RaidAimActions,
  type RaidAimFeedback,
} from './raid-aim-pad.ts';
import './styles/raid.css';
import './styles/raid-touch.css';
import './styles/raid-scoreboard.css';

interface RaidActions extends RaidAimActions {
  repeatCast(slot: Skill): void;
  ping(intent: RaidPing): void;
  skill(slot: Skill): void;
  target(): void;
  pause(): void;
  resume(): void;
  retry(): void;
  leave(): void;
  jump(held?: boolean): void;
  steer(side: number, brake: number): void;
  beginPadAim(): void;
  setHudPreference(key: keyof RaidHudSettings, value: number): void;
}

// A second thumb or a preceding aim drag can suppress the browser's compatibility click.
function hudButton(parent: HTMLElement, label: string, action: () => void) {
  const control = button(parent, label);
  control.onpointerdown = (event) => {
    if (event.button === 0) control.setPointerCapture(event.pointerId);
  };
  control.onpointerup = (event) => {
    if (
      event.button === 0 &&
      control.hasPointerCapture(event.pointerId) &&
      control.contains(document.elementFromPoint(event.clientX, event.clientY))
    )
      action();
  };
  control.onclick = (event) => {
    if (event.detail === 0) action();
  };
  return control;
}
export function createRaidHud(
  actions: RaidActions,
  course: HTMLCanvasElement,
  settings: RaidHudSettings,
) {
  const root = element('section', document.body);
  root.className = 'raid-hud';
  root.hidden = true;
  const drawCombatNumbers = createRaidCombatNumbers(root);
  const updateScore = createRaidScoreboard(root);
  const pauseButton = hudButton(root, '⚙︎', actions.pause);
  pauseButton.className = 'raid-pause';
  pauseButton.setAttribute('aria-label', t('pause'));
  pauseButton.setAttribute('aria-haspopup', 'dialog');
  pauseButton.title = t('pause');
  const hint = element('output', root);
  let feedbackUntil = 0;
  hint.className = 'raid-hint';
  const respawn = element('div', root);
  respawn.className = 'raid-respawn';
  respawn.hidden = true;
  respawn.setAttribute('role', 'status');
  element('strong', respawn, t('defeated'));
  const countdown = element('span', respawn);
  const startCountdown = element('output', root);
  startCountdown.className = 'raid-start-countdown';
  startCountdown.setAttribute('aria-label', t('startCountdown'));
  startCountdown.hidden = true;
  const stick = createTouchPad(
    t('steer'),
    { shape: 'semicircle', surface: course, moveLabel: t('movePad'), walkLabel: t('walkPad') },
    actions.steer,
  );
  root.append(stick.pad);
  const deck = element('div', root);
  deck.className = 'raid-deck';
  const vitals = element('div', deck);
  vitals.className = 'raid-vitals';
  const hp = element('div', vitals);
  hp.className = 'raid-health';
  hp.setAttribute('role', 'meter');
  hp.setAttribute('aria-label', t('hp'));
  hp.setAttribute('aria-valuemin', '0');
  const hpText = element('strong', hp);
  const hpBar = element('canvas', hp);
  hpBar.width = 200;
  hpBar.height = 24;
  hpBar.setAttribute('aria-hidden', 'true');
  const paintHp = healthMeterPainter(hpBar.getContext('2d')!, hpBar.width, hpBar.height);
  const protection = element('small', hp);
  protection.className = 'raid-protection';
  const rage = element('span', vitals);
  const condition = element('output', vitals);
  condition.className = 'raid-condition';
  condition.hidden = true;
  const orders = element('div', vitals);
  orders.className = 'raid-orders';
  const lock = hudButton(orders, '', actions.target);
  const ping = createRaidPing(deck, actions.ping);
  const jump = button(deck, '');
  const jumpLabel = element('span', jump, t('jump'));
  const fuel = element('progress', jump);
  fuel.max = JET_CAPACITY;
  fuel.hidden = true;
  fuel.setAttribute('aria-label', t('jetFuel'));
  let heldJet: number | null = null;
  // A second thumb does not always produce a compatibility click while steering.
  jump.onpointerdown = (e) => {
    if (e.button !== 0 || heldJet !== null) return;
    jump.setPointerCapture(e.pointerId);
    if (!fuel.hidden) {
      heldJet = e.pointerId;
      actions.jump(true);
    }
  };
  function releaseJet(e: PointerEvent) {
    if (heldJet !== e.pointerId) return false;
    heldJet = null;
    actions.jump(false);
    return true;
  }
  jump.onpointercancel = jump.onlostpointercapture = releaseJet;
  jump.onpointerup = (e) => {
    if (releaseJet(e)) return;
    if (
      e.button === 0 &&
      jump.hasPointerCapture(e.pointerId) &&
      jump.contains(document.elementFromPoint(e.clientX, e.clientY))
    )
      actions.jump();
  };
  jump.onclick = (e) => {
    if (e.detail === 0) actions.jump();
  };
  jump.className = 'raid-jump';
  const aimPad = new RaidAimPad(root, actions);
  const skills = createSkillRack(deck, aimPad, actions);
  const menu = createRaidMenu(root, actions, settings);
  const result = createRaidResult(actions);
  function update(view: RaidView, aiming: Skill | null, slot = 0) {
    // A keyboard-armed skill can point to either half of the screen.
    if (aiming !== null && !stick.pad.hidden) stick.reset();
    stick.pad.hidden = aiming !== null;
    const runner = view.runners[slot]!;
    updateScore(view, runner);
    jump.disabled = heldJet === null && !canPressJump(runner);
    fuel.hidden = runner.jetFuel === undefined;
    const nextLabel = t(
      runner.jetFuel !== undefined ? 'jet' : runner.air && !runner.air.second ? 'airJump' : 'jump',
    );
    if (jumpLabel.textContent !== nextLabel) jumpLabel.textContent = nextLabel;
    if (runner.jetFuel !== undefined) {
      fuel.value = runner.jetFuel;
      jump.setAttribute(
        'aria-label',
        t('jetHold') + ' · ' + t('jetFuel') + ' ' + Math.round((100 * fuel.value) / fuel.max) + '%',
      );
    } else
      jump.setAttribute('aria-label', t(runner.air && !runner.air.second ? 'airJump' : 'jump'));
    const request = view.calls[runner.team];
    ping.update(
      view,
      runner.team,
      !!runner.respawn || !!request || !!view.result || aiming !== null || aimPad.skill !== null,
    );
    const slow = activeSlow(runner);
    const conditions = [
      runner.stunned ? t('stun') : runner.staggered && t('stagger'),
      runner.launchDuration && t('knockedUp'),
      slow && t('slow', { percent: slow.percent }),
      runner.silenced && t('silence'),
      runner.taunt && t('taunted'),
    ]
      .filter(Boolean)
      .join(' · ');
    if (condition.textContent !== conditions) condition.textContent = conditions;
    condition.hidden = !conditions || !!runner.respawn;
    const vitals = healthMeter(runner, view.tick);
    if (paintHp(vitals, true)) {
      hpText.textContent = t('hp') + ' ' + vitals.hp + '/' + vitals.max;
      const status = [
        vitals.barrier && t('barrierPoints', { n: vitals.barrier }),
        vitals.reducedDamage && t('damageWard'),
        vitals.guarding && t('guardActive'),
      ]
        .filter(Boolean)
        .join(' · ');
      protection.textContent = status;
      protection.hidden = !status;
      hp.setAttribute('aria-valuemax', String(vitals.max));
      hp.setAttribute('aria-valuenow', String(vitals.hp));
      hp.setAttribute('aria-valuetext', [hpText.textContent, status].filter(Boolean).join(' · '));
    }
    const resources: string[] = [];
    if (raidRageDamageToFull(runner.hero) !== null)
      resources.push(t('rage') + ' ' + Math.floor(runner.rage) + '%');
    if (runner.heroView.comboPoints !== undefined)
      resources.push(t('shadowCombo', { count: runner.heroView.comboPoints }));
    if (runner.heroView.poisonArmed) resources.push(t('poisonArmed'));
    if (runner.heroView.firingStacks)
      resources.push(t('firingStacks', { count: runner.heroView.firingStacks }));
    if (runner.heroView.iceCrystals !== undefined)
      resources.push(t('iceCrystals', { count: runner.heroView.iceCrystals }));
    if (runner.heroView.shieldMode !== undefined)
      resources.push(t(runner.heroView.shieldMode ? 'magnusFury' : 'magnusBattle'));
    rage.textContent = resources.join(' · ');
    const target =
      runner.target === null
        ? 'noTarget'
        : runner.target === 'wagon'
          ? 'wagon'
          : view.runners[runner.target]!.hero;
    lock.textContent = t('target') + ' · ' + t(target);
    skills.update(runner, aiming);
    if (runner.respawn) {
      const remaining = t('respawn', { seconds: Math.ceil(runner.respawn / RAID_HZ) });
      if (countdown.textContent !== remaining) countdown.textContent = remaining;
    }
    respawn.hidden = !runner.respawn;
    if (aiming !== null || performance.now() >= feedbackUntil)
      hint.textContent = aiming !== null ? t('aim') : '';
    hint.hidden = !!runner.respawn || !hint.textContent;
  }
  function showPanel(
    view: RaidView | null,
    slot = 0,
    online = false,
    outfits: readonly (string | undefined)[] = [],
  ) {
    heldJet = null;
    stick.reset();
    ping.close();
    aimPad.close();
    skills.endGesture();
    actions.clearPreview();
    root.hidden = !!view;
    root.inert = true;
    if (view?.result) {
      menu.hide();
      result.show(view, view.result, slot, online, outfits);
    } else menu.show(online);
  }
  function showStartCountdown(seconds: number) {
    const text = seconds > 0 ? String(seconds) : '';
    if (startCountdown.textContent === text) return;
    startCountdown.hidden = seconds === 0;
    startCountdown.textContent = text;
    deck.inert = seconds > 0;
  }
  return {
    aimPad,
    updateSkills: skills.update,
    drawCombatNumbers,
    reset() {
      heldJet = null;
      ping.close();
      menu.hide();
      result.hide();
      root.hidden = true;
      aimPad.close();
      stick.reset();
      skills.endGesture();
    },
    update,
    showStartCountdown,
    showPanel,
    showSkillAim(aim: RaidAimFeedback) {
      hint.hidden = false;
      const { state, metrics } = aimFeedback(aim);
      const text = state + ' · ' + metrics;
      if (hint.textContent !== text) hint.textContent = text;
    },
    play(seconds: number) {
      feedbackUntil = 0;
      menu.hide();
      result.hide();
      root.inert = false;
      root.hidden = false;
      showStartCountdown(seconds);
    },
    showFeedback(text: string) {
      hint.textContent = text;
      hint.hidden = false;
      feedbackUntil = performance.now() + 1500;
    },
  };
}
