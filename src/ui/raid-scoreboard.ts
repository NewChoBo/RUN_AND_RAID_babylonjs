import { raidText as t } from '../content/locales/run-and-raid.ts';
import {
  raidBossBonusPercent,
  RAID_HZ,
  ROUND_TICKS,
  WAGON_HP,
  type RaidView,
} from '../game/raid/raid-match.ts';
import { element } from './elements.ts';

import type { RaidRunner } from '../game/raid/raid-view.ts';
export function matchClock(seconds: number) {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
const counterLabels = {
  lane: 'counterLane',
  mortar: 'counterMortar',
  wave: 'counterWave',
} as const;
export function createRaidScoreboard(root: HTMLElement) {
  const score = element('header', root);
  score.className = 'raid-score';
  function team(name: 'blue' | 'red') {
    const group = element('div', score);
    group.className = 'raid-team ' + name;
    element('small', group, t(name === 'blue' ? 'allies' : 'enemies'));
    const value = element('strong', group);
    const bar = element('progress', group);
    bar.max = WAGON_HP;
    bar.setAttribute('aria-label', t(name) + ' · ' + t('wagonHealth'));
    const kills = element('small', group);
    kills.className = 'raid-kills';
    const bonus = element('small', group);
    bonus.className = 'raid-boss-bonus';
    bonus.hidden = true;
    return { group, value, bar, kills, bonus };
  }
  const blue = team('blue');
  const clock = element('time', score);
  clock.setAttribute('aria-label', t('time'));
  const red = team('red');
  const personal = element('small', blue.group);
  personal.className = 'raid-personal-score';
  const enemyRespawns = element('div', score);
  enemyRespawns.className = 'raid-enemy-respawns';
  enemyRespawns.hidden = true;
  const enemyHeading = element('strong', enemyRespawns, t('enemyRespawns'));
  enemyHeading.id = 'raid-enemy-respawns-title';
  const enemyList = element('ul', enemyRespawns);
  enemyList.setAttribute('aria-labelledby', enemyHeading.id);
  const warning = element('output', score);
  warning.className = 'raid-counter';
  warning.hidden = true;
  const callout = element('output', score);
  callout.className = 'raid-callout';
  callout.hidden = true;
  return function update(view: RaidView, runner: RaidRunner) {
    const request = view.calls[runner.team];
    const fallen = view.runners.filter((r) => r.team !== runner.team && r.respawn > 0);
    enemyRespawns.hidden = fallen.length === 0;
    while (enemyList.children.length > fallen.length) enemyList.lastElementChild!.remove();
    fallen.forEach((r, i) => {
      const row = enemyList.children[i] ?? element('li', enemyList);
      const text = t('runnerRespawn', { name: t(r.hero), seconds: Math.ceil(r.respawn / RAID_HZ) });
      if (row.textContent !== text) row.textContent = text;
    });
    const from = request && t(view.runners[request.from]!.hero);
    let message = '';
    if (request && from) {
      message =
        'movement' in request
          ? t('moveRequest', { from, movement: t(request.movement) })
          : t('attackRequest', {
              from,
              target: t(request.target === 'wagon' ? 'wagon' : view.runners[request.target]!.hero),
            });
    }
    if (callout.textContent !== message) callout.textContent = message;
    callout.hidden = !message;
    const counterText = view.hazard ? t(counterLabels[view.hazard.kind]) : '';
    if (warning.textContent !== counterText) warning.textContent = counterText;
    warning.hidden = !counterText || !!view.result;
    const seconds = Math.ceil((ROUND_TICKS - view.tick) / RAID_HZ);
    clock.textContent = matchClock(seconds);
    personal.textContent = [runner.kills, runner.deaths, runner.assists].join(' / ');
    personal.setAttribute('aria-label', t('kda') + ' ' + personal.textContent);
    [blue, red].forEach((side, i) => {
      const teamId = i ^ runner.team;
      const dmg = Math.min(WAGON_HP, view.damage[teamId]!);
      side.bar.value = WAGON_HP - dmg;
      const remaining = Math.ceil((side.bar.value / WAGON_HP) * 100) + '%';
      side.value.textContent = remaining;
      side.bar.setAttribute('aria-valuetext', remaining);
      const kills = view.runners.reduce((sum, r) => sum + (r.team === teamId ? r.kills : 0), 0);
      side.kills.textContent = String(kills);
      side.kills.setAttribute('aria-label', t('teamKills', { count: kills }));
      const percent = raidBossBonusPercent(view.runners, teamId);
      const bonus = percent ? t('bossBonus', { percent }) : '';
      if (side.bonus.textContent !== bonus) side.bonus.textContent = bonus;
      side.bonus.hidden = !percent;
    });
  };
}
