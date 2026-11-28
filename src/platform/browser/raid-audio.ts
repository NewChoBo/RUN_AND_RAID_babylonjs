import { getLocale } from '../../content/locales/locale.ts';
import { heroKit } from '../../game/raid/heroes/hero-id.ts';
import { raidSkill } from '../../game/raid/heroes/hero-catalog.ts';
import type { RaidAction, RaidView } from '../../game/raid/raid-view.ts';

const effects = [
  'hammer',
  'blade',
  'bow',
  'shot',
  'fire',
  'ice',
  'void',
  'spark',
  'ward',
  'impact',
  'count',
  'signal',
] as const;
type Effect = (typeof effects)[number];
type Voice = 'go' | 'advance' | 'retreat' | 'focus';
type Channel = 'effects' | 'voice';
// Each row follows basic attack, Q, W, E and R in the current playable kit.
const sounds: Partial<
  Record<ReturnType<typeof heroKit>, readonly [Effect, Effect, Effect, Effect, Effect]>
> = {
  hammer: ['hammer', 'impact', 'hammer', 'blade', 'hammer'],
  longshot: ['bow', 'bow', 'bow', 'bow', 'bow'],
  flare: ['fire', 'fire', 'impact', 'spark', 'fire'],
  alice: ['ward', 'impact', 'ward', 'spark', 'ward'],
  hof: ['shot', 'shot', 'ice', 'spark', 'impact'],
  kali: ['blade', 'blade', 'void', 'void', 'blade'],
  kaiken: ['blade', 'blade', 'spark', 'blade', 'blade'],
  abyss: ['void', 'void', 'spark', 'void', 'void'],
  froze: ['ice', 'ice', 'impact', 'ward', 'ice'],
  magnus: ['hammer', 'hammer', 'spark', 'ward', 'impact'],
  swift: ['blade', 'blade', 'blade', 'spark', 'blade'],
  rildin: ['blade', 'blade', 'hammer', 'blade', 'spark'],
  jade: ['spark', 'ward', 'spark', 'spark', 'impact'],
  theresa: ['hammer', 'ward', 'hammer', 'blade', 'impact'],
  drizz: ['void', 'void', 'hammer', 'impact', 'hammer'],
  vallet: ['shot', 'shot', 'blade', 'shot', 'shot'],
  freesia: ['spark', 'spark', 'ward', 'ward', 'void'],
};

const disabled = new Set<Channel>();
for (const channel of ['effects', 'voice'] as const) {
  try {
    if (localStorage.getItem('run-and-raid.audio.' + channel) === 'off') disabled.add(channel);
  } catch {
    /* Storage is optional in embedded browsers. */
  }
}
export const audioEnabled = (channel: Channel) => !disabled.has(channel);
export function setAudioEnabled(channel: Channel, enabled: boolean) {
  if (enabled) disabled.delete(channel);
  else disabled.add(channel);
  try {
    localStorage.setItem('run-and-raid.audio.' + channel, enabled ? 'on' : 'off');
  } catch {}
}

/** Cue ownership stays with the match. The audio clock only plays short samples. */
export function createRaidAudio() {
  let context: AudioContext | undefined;
  const buffers = new Map<string, AudioBuffer>();
  const loading = new Set<string>();
  const active = new Set<AudioBufferSourceNode>();
  let voice: AudioBufferSourceNode | undefined;
  let seen = new WeakSet<object>();
  let countdown = -1;
  function unlock() {
    if (location.hash !== '#/ready' || !window.AudioContext) return;
    try {
      context ??= new AudioContext();
      if (context.state !== 'running') void context.resume().catch(() => {});
    } catch {
      return;
    }
    const ctx = context;
    for (const name of [
      ...effects,
      ...['go', 'advance', 'retreat', 'focus'].map((v) => getLocale() + '-' + v),
    ]) {
      if (buffers.has(name) || loading.has(name)) continue;
      loading.add(name);
      void fetch('./assets/audio/' + name + '.wav')
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => buffers.set(name, buffer))
        .catch(() => {})
        .finally(() => loading.delete(name));
    }
  }
  function play(name: string, channel: Channel, volume: number, speed = 1) {
    const buffer = buffers.get(name);
    if (!audioEnabled(channel) || document.hidden || !buffer || context?.state !== 'running')
      return;
    if (channel === 'voice') voice?.stop();
    else if (active.size >= 10) return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.playbackRate.value = speed;
    source.connect(gain).connect(context.destination);
    active.add(source);
    if (channel === 'voice') voice = source;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      active.delete(source);
      if (voice === source) voice = undefined;
    };
    source.start();
  }
  const say = (line: Voice) => play(getLocale() + '-' + line, 'voice', 0.82);
  function stop() {
    for (const source of active) source.stop();
  }
  function suspend() {
    stop();
    if (context?.state === 'running') void context.suspend().catch(() => {});
  }
  function releaseTick(cue: RaidAction) {
    const attack = cue.skill === 'basic' ? undefined : raidSkill(cue.hero, cue.skill).attack;
    return cue.tick + (attack?.kind === 'projectile' ? (attack.windupTicks ?? 0) : 0);
  }
  return {
    unlock,
    suspend,
    reset() {
      stop();
      seen = new WeakSet();
      countdown = -1;
    },
    skipPast(view: RaidView) {
      for (const cue of view.actions) if (releaseTick(cue) <= view.tick) seen.add(cue);
      for (const change of view.healthChanges) seen.add(change);
      for (const r of view.runners ?? []) {
        for (const arrow of r.heroView.airArrows ?? []) seen.add(arrow);
        for (const turret of r.heroView.turrets ?? []) if (turret.shot) seen.add(turret.shot);
      }
      for (const call of view.calls) if (call) seen.add(call);
    },
    count(seconds: number) {
      if (seconds === countdown) return;
      countdown = seconds;
      play(seconds ? 'count' : 'signal', 'effects', 0.29);
      if (!seconds) say('go');
    },
    update(view: RaidView, slot: number) {
      for (const cue of view.actions) {
        if (seen.has(cue)) continue;
        const age = view.tick - releaseTick(cue);
        if (age < 0) continue;
        seen.add(cue);
        if (age > 9 || cue.cancelledAt !== undefined) continue;
        const basic = cue.skill === 'basic';
        const sound =
          sounds[heroKit(cue.hero)]?.[cue.skill === 'basic' ? 0 : cue.skill + 1] ?? 'impact';
        const volume = (cue.slot === slot ? 0.55 : 0.24) * (basic ? 0.55 : 1);
        play(sound, 'effects', volume, cue.skill === 3 ? 0.78 : basic ? 1.18 : 1);
      }
      for (const r of view.runners ?? []) {
        function sound(event: { tick: number }, clip: Effect) {
          if (seen.has(event)) return;
          seen.add(event);
          if (view.tick - event.tick <= 3) play(clip, 'effects', r.slot === slot ? 0.28 : 0.14);
        }
        for (const arrow of r.heroView.airArrows ?? []) sound(arrow, 'bow');
        for (const turret of r.heroView.turrets ?? [])
          if (turret.shot) sound(turret.shot, (['shot', 'ice', 'spark'] as const)[turret.slot]);
      }
      let hit = false,
        heal = false;
      for (const change of view.healthChanges) {
        if (seen.has(change)) continue;
        seen.add(change);
        if (view.tick - change.tick > 9 || (change.target !== slot && change.from !== slot))
          continue;
        if (change.amount > 0) heal = true;
        else hit = true;
      }
      if (hit) play('impact', 'effects', 0.38);
      if (heal) play('ward', 'effects', 0.32, 1.24);
      const call = view.calls[view.runners[slot]!.team];
      if (call && !seen.has(call)) {
        seen.add(call);
        play('signal', 'effects', 0.29);
        say('movement' in call ? call.movement : 'focus');
      }
    },
  };
}
