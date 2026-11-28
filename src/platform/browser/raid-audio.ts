import { heroKit } from '../../game/raid/heroes/hero-id.ts';
import { raidSkill } from '../../game/raid/heroes/hero-catalog.ts';
import type { RaidAction, RaidView } from '../../game/raid/raid-view.ts';
import { audioVolume } from './battle-settings.ts';

const effects = [
  'ping',
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

/** Cue ownership stays with the match. The audio clock only plays short samples. */
export function createRaidAudio() {
  let context: AudioContext | undefined;
  const buffers = new Map<Effect, AudioBuffer>();
  const loading = new Set<Effect>();
  const active = new Set<AudioBufferSourceNode>();
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
    for (const name of effects) {
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
  function play(name: Effect, volume: number, speed = 1) {
    const buffer = buffers.get(name);
    const percent = audioVolume();
    if (!percent || document.hidden || !buffer || context?.state !== 'running') return;
    // An accepted team ping stays audible even during a full volley of combat sounds.
    if (active.size >= 10 && name !== 'ping') return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = (volume * percent) / 100;
    source.playbackRate.value = speed;
    source.connect(gain).connect(context.destination);
    active.add(source);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      active.delete(source);
    };
    source.start();
  }
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
      play(seconds ? 'count' : 'signal', 0.29);
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
        play(sound, volume, cue.skill === 3 ? 0.78 : basic ? 1.18 : 1);
      }
      for (const r of view.runners ?? []) {
        function sound(event: { tick: number }, clip: Effect) {
          if (seen.has(event)) return;
          seen.add(event);
          if (view.tick - event.tick <= 3) play(clip, r.slot === slot ? 0.28 : 0.14);
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
      if (hit) play('impact', 0.38);
      if (heal) play('ward', 0.32, 1.24);
      const call = view.calls[view.runners[slot]!.team];
      if (call && !seen.has(call)) {
        seen.add(call);
        play('ping', 0.44);
      }
    },
  };
}
