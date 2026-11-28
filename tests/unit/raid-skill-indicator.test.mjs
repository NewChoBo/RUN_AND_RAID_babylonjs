import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidMatch, RAID_HZ } from '../../src/game/raid/raid-match.ts';
import { raidSkillIndicator } from '../../src/ui/raid-skill-indicator.ts';

test('a cooldown counts down through its last visible tenth and stays locked until the final tick', () => {
  const match = new RaidMatch('hammer');
  const runner = match.runners[0];
  assert.ok(match.cast(0, 0));
  runner.cooldowns[0] = RAID_HZ + 1;
  for (let ticks = RAID_HZ + 1; ticks > 0; ticks--) {
    const status = raidSkillIndicator(runner, 0);
    assert.equal(status.ready, false);
    assert.equal(status.ticks, ticks);
    assert.equal(status.value, ticks > RAID_HZ ? '2' : String(Math.ceil(ticks / 3) / 10));
    assert.ok(!match.cast(0, 0));
    match.step();
  }
  assert.equal(raidSkillIndicator(runner, 0).value, '');
  assert.equal(raidSkillIndicator(runner, 0).ready, true);
  assert.ok(match.cast(0, 0));
});

test('combo charges and rage never cover a running cooldown', () => {
  const rildin = new RaidMatch('rildin'),
    runner = rildin.runners[0];
  assert.ok(rildin.cast(0, 0));
  assert.equal(raidSkillIndicator(runner, 0).value, '0.3');
  assert.equal(raidSkillIndicator(runner, 0).ready, false);
  while (runner.cooldowns[0]) rildin.step();
  assert.equal(raidSkillIndicator(runner, 0).value, '3/4');
  assert.equal(raidSkillIndicator(runner, 0).ready, true);

  const kali = new RaidMatch('kali'),
    assassin = kali.runners[0];
  assassin.rage = 100;
  assert.ok(kali.cast(0, 3, { dx: 1, dz: 0 }));
  assert.equal(raidSkillIndicator(assassin, 3).value, '3');
  assert.equal(raidSkillIndicator(assassin, 3).ready, false);
  while (assassin.cooldowns[3]) kali.step();
  assert.equal(raidSkillIndicator(assassin, 3).ready, true);
  assert.match(raidSkillIndicator(assassin, 3).value, /2/);

  const hammer = new RaidMatch('hammer').runners[0];
  hammer.rage = 100;
  hammer.cooldowns[3] = hammer.cooldownDurations[3] = 1;
  assert.equal(raidSkillIndicator(hammer, 3).value, '0.1');
  assert.equal(raidSkillIndicator(hammer, 3).ready, false);
  hammer.cooldowns[3] = 0;
  assert.equal(raidSkillIndicator(hammer, 3).ready, true);
  assert.equal(raidSkillIndicator(hammer, 3).value, '');
  hammer.rage = 65;
  assert.equal(raidSkillIndicator(hammer, 3).value, '65%');
  assert.equal(raidSkillIndicator(hammer, 3).ready, false);
});

test('immediate follow-ups display their actionable state despite the underlying cooldown', () => {
  for (const hero of ['kaiken', 'vallet']) {
    const match = new RaidMatch(hero),
      runner = match.runners[0];
    assert.ok(match.cast(0, 2));
    assert.ok(runner.cooldowns[2] > 0);
    const followup = raidSkillIndicator(runner, 2);
    assert.equal(followup.ready, true);
    assert.equal(followup.ticks, 0);
    assert.equal(followup.degrees, 0);
    assert.equal(followup.value, '');
    assert.ok(match.cast(0, 2));
    assert.ok(raidSkillIndicator(runner, 2).ticks > 0);
  }
  const drizz = new RaidMatch('drizz').runners[0];
  assert.equal(raidSkillIndicator(drizz, 2).ready, false);
  assert.equal(raidSkillIndicator(drizz, 2).value, '');
});

test('the mode switch has a normal timer and other skill requirements still dim ready timers', () => {
  const match = new RaidMatch('magnus'),
    runner = match.runners[0];
  assert.ok(raidSkillIndicator(runner, 3).ready);
  assert.ok(match.cast(0, 3));
  assert.equal(raidSkillIndicator(runner, 3).usesRage, false);
  assert.equal(raidSkillIndicator(runner, 3).value, '6');

  const hof = new RaidMatch('hof').runners[0];
  hof.rage = 100;
  const ultimate = raidSkillIndicator(hof, 3);
  assert.equal(ultimate.ticks, 0);
  assert.equal(ultimate.ready, false);
  assert.equal(ultimate.value, '');
});
