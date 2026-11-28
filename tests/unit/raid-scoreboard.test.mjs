import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocale, setLocale } from '../../src/content/locales/locale.ts';
import { RaidMatch } from '../../src/game/raid/raid-match.ts';
import { teamCallMessage } from '../../src/ui/raid-scoreboard.ts';

test('only the local team sees its active call, using the localized movement or attack target', (t) => {
  const original = getLocale();
  t.after(() => setLocale(original));
  const roster = ['hammer', 'longshot', 'alice', 'kaiken'];
  for (const [intent, korean, english] of [
    ['advance', '팀원메시지: 전진! 앞으로 가자', 'Team message: Advance! Push forward!'],
    ['retreat', '팀원메시지: 후퇴! 뒤로 빠지자', 'Team message: Retreat! Fall back!'],
    ['enemy1', '팀원메시지: 앨리스 집중공격!', 'Team message: Focus fire on Alice!'],
    ['wagon', '팀원메시지: 마차 집중공격!', 'Team message: Focus fire on the wagon!'],
  ]) {
    const match = new RaidMatch(roster);
    assert.ok(match.callTarget(1, intent));
    setLocale('ko');
    assert.deepEqual(teamCallMessage(match, 0), { text: korean, label: '롱샷의 팀원메시지' });
    assert.equal(teamCallMessage(match, 1), null);
    setLocale('en');
    assert.deepEqual(teamCallMessage(match, 0), {
      text: english,
      label: 'Team message from Longshot',
    });

    const lastFrame = { calls: match.calls, runners: match.runners, tick: match.tick };
    assert.equal(teamCallMessage({ ...lastFrame, tick: match.calls[0].until }, 0), null);
    assert.equal(teamCallMessage({ ...lastFrame, result: { reason: 'time', winner: 0 } }, 0), null);
    assert.equal(teamCallMessage(new RaidMatch(roster), 0), null);
  }
});
