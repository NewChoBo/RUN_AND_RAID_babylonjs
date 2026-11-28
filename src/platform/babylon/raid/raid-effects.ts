import { actionLocked } from '../../../game/raid/raid-control.ts';
import { lungeTicks } from '../../../content/raid/heroes/swift.ts';
import { FULL_MOON_SPIN_TICKS } from '../../../game/raid/heroes/kaiken.ts';
import { heroKit, KIT_IDS } from '../../../game/raid/heroes/hero-id.ts';
import { appearance } from './hero-appearance.ts';
import { raidProjectileProfile, raidSkill } from '../../../game/raid/heroes/hero-catalog.ts';
import { createBladeWave } from './raid-blade-wave.ts';
import { createHofTurrets } from './raid-hof-turrets.ts';
import { createAirArrows } from './raid-air-arrows.ts';
import { createRaidArrowRain } from './raid-arrow-rain.ts';
import { createSwiftDaggerFx } from './raid-swift-dagger.ts';
import { createIgnitionFx, createFlame, createFlameMaterial } from './raid-ignition.ts';
import { createFlyingShots } from './raid-flying-shots.ts';
import { createRaidDashWind, type DashShoulders } from './raid-dash-wind.ts';
import { createShadowBlades } from './raid-shadow-blades.ts';
import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector3,
  type LinesMesh,
  type Scene,
} from '@babylonjs/core';
import {
  raidAimKind,
  raidGroundPointAfter,
  raidRespawnTicks,
  RAID_LEAP_TICKS,
  raidRunnerPositionAfter,
  raidRunnerHeight,
  type RaidAction,
  type RaidHero,
  type RaidPoint,
  type RaidView,
} from '../../../game/raid/raid-match.ts';
import { raidColors } from './raid-material.ts';

const lifetime = (cue: RaidAction) =>
  cue.skill !== 'basic' && raidAimKind(cue.hero, cue.skill) === 'field'
    ? Math.max(36, (cue.fieldTicks ?? 0) + 4)
    : cue.phase === 'spin' && cue.hero === 'kaiken' && cue.skill === 2
      ? FULL_MOON_SPIN_TICKS
      : cue.skill === 3
        ? 28
        : cue.skill === 'basic'
          ? 10
          : 18;
const tau = Math.PI * 2;

// First forward strike / downswing in the four authored 30 FPS battle skins of each hero.
function contactDelay(cue: RaidAction) {
  if (cue.hero === 'hammer') {
    if (cue.skill === 'basic') return 7 / (cue.basicSpeed ?? 1);
    if (cue.skill === 0) return 10;
    if (cue.skill === 1 && cue.phase === 'ground') return 16 - RAID_LEAP_TICKS;
  }
  return cue.hero === 'kaiken' && cue.skill === 'basic' ? 6 / (cue.basicSpeed ?? 1) : 0;
}

function interruptedBeforeContact(view: RaidView, cue: RaidAction, contact: number) {
  const runner = view.runners[cue.slot]!;
  if (runner.respawn && view.tick - (raidRespawnTicks(runner.deaths) - runner.respawn) <= contact)
    return true;
  // Hammer's leap records its action on landing. Takeoff already replaced the previous swing.
  if (runner.leap && view.tick - runner.leap.elapsed <= contact) return true;
  return view.actions.some((next) => {
    if (next.slot !== cue.slot || next.id <= cue.id || next.skill === 'basic') return false;
    const takeoff = next.hero === 'hammer' && next.skill === 1 && next.phase === 'ground';
    return next.tick - (takeoff ? RAID_LEAP_TICKS : 0) <= contact;
  });
}

/** Effects sample match ticks, so pausing, catching up and starting a rematch have no independent timers. */
export function createRaidEffects(
  scene: Scene,
  hasBladeTrail: (hero: RaidHero) => boolean = () => false,
  shoulders?: (hero: RaidHero) => DashShoulders | undefined,
) {
  const drawDashWind = createRaidDashWind(scene, shoulders);
  const drawTurrets = createHofTurrets(scene);
  const drawAirArrows = createAirArrows(scene);
  const drawSwiftDagger = createSwiftDaggerFx(scene);
  const fire = createFlameMaterial(scene);
  const drawIgnition = createIgnitionFx(scene, fire);
  const materials = new Map<RaidHero, { sigil: StandardMaterial; light: StandardMaterial }>();
  for (const hero of KIT_IDS) {
    const color = Color3.FromHexString(raidColors[hero]);
    const light = new StandardMaterial(hero + ' impact light', scene);
    light.disableLighting = true;
    light.emissiveColor = color;
    const sigil = light.clone(hero + ' particle ink')!;
    const mask = new Texture('./assets/raid/' + appearance[hero].sprite + '.png', scene);
    // The artist's PNGs store intensity in RGB on an opaque black background.
    mask.getAlphaFromRGB = true;
    sigil.opacityTexture = mask;
    sigil.backFaceCulling = false;
    sigil.disableDepthWrite = true;
    materials.set(hero, { sigil, light });
  }
  function allocate() {
    const stamp = MeshBuilder.CreatePlane('raid ground sigil', { size: 1 }, scene);
    stamp.rotation.x = Math.PI / 2;
    const flare = MeshBuilder.CreatePlane('raid impact flash', { size: 1 }, scene);
    flare.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const ring = MeshBuilder.CreateTorus(
      'raid impact rim',
      { diameter: 2, thickness: 0.037, tessellation: 40 },
      scene,
    );
    const shards = Array.from({ length: 6 }, () =>
      MeshBuilder.CreateCylinder(
        'raid tracer',
        {
          diameterTop: 0,
          diameterBottom: 0.13,
          height: 1,
          tessellation: 4,
        },
        scene,
      ),
    );
    let sector: LinesMesh | undefined;
    let pillars: Mesh[] | undefined;
    let sectorAngle: number | undefined;
    let rain: ReturnType<typeof createRaidArrowRain> | undefined;
    let blades: ReturnType<typeof createShadowBlades> | undefined;
    let lightning: LinesMesh | undefined;
    let swordCut: Mesh | undefined;
    let slamOrigin: RaidPoint | undefined;
    const parts = [stamp, flare, ring, ...shards];
    function hide() {
      slamOrigin = undefined;
      for (const part of parts) part.setEnabled(false);
      sector?.setEnabled(false);
      for (const pillar of pillars ?? []) pillar.setEnabled(false);
      swordCut?.setEnabled(false);
      rain?.hide();
      blades?.hide();
      lightning?.dispose();
      lightning = undefined;
    }
    for (const part of parts) part.isPickable = false;
    hide();
    function draw(cue: RaidAction, age: number, view: RaidView, subtick: number, delay: number) {
      const { hero, skill } = cue;
      const art = appearance[heroKit(hero)];
      if (cue.lines?.length && !lightning) {
        const lines = cue.lines.map(({ from, to }) => {
          const dx = to.x - from.x,
            dz = to.z - from.z;
          return [
            new Vector3(from.x, 1.45, from.z),
            new Vector3(from.x + dx * 0.34 + dz * 0.03, 1.68, from.z + dz * 0.34 - dx * 0.03),
            new Vector3(from.x + dx * 0.66 - dz * 0.03, 1.33, from.z + dz * 0.66 + dx * 0.03),
            new Vector3(to.x, 1.45, to.z),
          ];
        });
        lightning = MeshBuilder.CreateLineSystem('Jade lightning', { lines }, scene);
        lightning.color = new Color3(0.55, 0.9, 1);
        lightning.isPickable = false;
      }
      if (cue.phase === 'dash' && art.dashTrail === 'shadowBlades') {
        const runner = view.runners[cue.slot]!;
        blades ??= createShadowBlades(scene);
        if (runner.respawn || actionLocked(runner)) blades.hide();
        else
          blades.draw(
            raidRunnerPositionAfter(runner, subtick),
            Math.atan2(cue.to.x - cue.from.x, cue.to.z - cue.from.z),
            age,
          );
        return;
      }
      const lunge = hero === 'swift' && skill === 1 && cue.phase === 'dash';
      if (
        ((hero === 'rildin' && skill === 0) || (hero === 'kali' && skill === 0) || lunge) &&
        !hasBladeTrail(hero)
      ) {
        swordCut ??= createBladeWave(scene, 'melee sword trail', new Color3(1, 0.81, 0.48));
        const runner = view.runners[cue.slot]!;
        const point = raidRunnerPositionAfter(runner, subtick);
        const phase = (age - (lunge ? lungeTicks : 0)) / 12;
        const facing = Math.atan2(cue.to.x - cue.from.x, cue.to.z - cue.from.z);
        const direction = (cue.comboStep ?? 0) % 2 ? -1 : 1;
        swordCut.setEnabled(!runner.respawn && !actionLocked(runner) && phase >= 0 && phase < 1);
        swordCut.rotation.set(0.16, facing + direction * (phase - 0.5) * 2.8, direction * 0.28);
        swordCut.position.set(point.x, 0.85 + raidRunnerHeight(runner, subtick), point.z);
        swordCut.scaling.set(1.6, 1, 2.5);
        swordCut.visibility = Math.max(0, 1 - phase * phase);
      } else swordCut?.setEnabled(false);
      // Swift cuts on arrival. The caster and sword already show both phases of the lunge.
      if (lunge) return;
      const kind = skill === 'basic' ? null : raidAimKind(hero, skill);
      const roadMotion = cue.phase === 'dash' || cue.phase === 'spin';
      const from = roadMotion ? raidGroundPointAfter(cue.from, age) : cue.from;
      let to =
        roadMotion || kind === 'field' || kind === 'leap'
          ? raidGroundPointAfter(cue.to, age + delay)
          : cue.to;
      if (hero === 'hammer' && skill === 0) {
        // Use the caster's position on the contact tick. If a frame skipped over it,
        // interpolate from the cast position to the latest sim position.
        if (!slamOrigin) {
          const runner = view.runners[cue.slot]!;
          const fraction = delay / (view.tick - cue.tick);
          slamOrigin = {
            x: from.x + (runner.x - from.x) * fraction,
            z: from.z + (runner.z - from.z) * fraction,
          };
        }
        to = raidGroundPointAfter(slamOrigin, age);
      }
      const t = age / lifetime(cue);
      const { sigil, light } = materials.get(heroKit(hero))!;
      const area = kind === 'field' || kind === 'leap' || kind === 'pulse';
      const healing = kind === 'ward';
      const impactTime = delay || area || healing || art.particles === 'heavy' ? 0 : 0.48;
      const burst = Math.max(0, (t - impactTime) / (1 - impactTime));
      const strength = skill === 3 ? 1.75 : skill === 'basic' ? 0.65 : 1;
      const radius = cue.footprint?.radius ?? strength;
      const halfAngle = cue.footprint?.halfAngle;
      const field = kind === 'field' && skill !== 'basic' ? raidSkill(hero, skill).attack : null;
      const volley =
        art.particles === 'arrows' && field?.kind === 'field' ? field.pulse : undefined;
      const ringSize = radius * Math.min(1, 0.18 + burst * 4);
      const fade = Math.min(1, (1 - t) * 4);
      const angle = tau * t;
      stamp.setEnabled(halfAngle === undefined && (area || skill === 3));
      stamp.material = flare.material = sigil;
      stamp.position.set(to.x, 0.08, to.z);
      stamp.rotation.y = art.particles === 'vortex' ? angle : cue.slot * 0.7;
      stamp.scaling.setAll(2 * ringSize * fade);
      ring.material = light;
      ring.setEnabled(halfAngle === undefined && (area || healing || skill === 3));
      if (halfAngle !== undefined) {
        if (!sector || sectorAngle !== halfAngle) {
          sector?.dispose();
          const points = Array.from({ length: 33 }, (_, i) => {
            const angle = halfAngle * (i / 16 - 1);
            return new Vector3(Math.sin(angle), 0, Math.cos(angle));
          });
          sector = MeshBuilder.CreateLines(
            'skill sector rim',
            { points: [Vector3.Zero(), ...points, Vector3.Zero()] },
            scene,
          );
          sector.isPickable = false;
          sectorAngle = halfAngle;
        }
        sector.color = light.emissiveColor;
        sector.position.set(from.x, 0.1, from.z);
        sector.scaling.setAll(ringSize * fade);
        sector.setEnabled(true);
      } else sector?.setEnabled(false);
      ring.position.set(to.x, healing ? 0.25 + t * 1.6 : 0.1 + 0.04 * Math.sin(angle), to.z);
      const rimRadius = volley ? radius : ringSize * fade;
      ring.scaling.set(rimRadius, 1, rimRadius);
      flare.setEnabled(true);
      const travel = impactTime ? Math.min(1, t / impactTime) : 1;
      const x = from.x + (to.x - from.x) * travel;
      const z = from.z + (to.z - from.z) * travel;
      const y = cue.fromY + (cue.toY - cue.fromY) * travel;
      flare.position.set(x, area ? 0.4 : y, z);
      flare.scaling.setAll((0.5 + Math.sin(Math.PI * t) * 1.8) * strength * fade);
      if (volley) {
        rain ??= createRaidArrowRain(scene);
        rain.draw(
          to,
          radius,
          age,
          volley.intervalTicks,
          volley.intervalTicks * volley.count,
          light,
        );
        for (const shard of shards) shard.setEnabled(false);
        return;
      }
      for (const [i, shard] of shards.entries()) {
        const a = (tau * i) / shards.length + cue.slot;
        const phase = (age / 15 + i * 0.19) % 1;
        shard.material = light;
        shard.setEnabled(true);
        if (heroKit(hero) === 'flare' && skill === 3) {
          pillars ??= shards.map(() => createFlame(scene, 'pillar of fire', fire));
          const pillar = pillars[i]!;
          const rise = Math.sin(Math.PI * t) * (3.5 + 2 * phase);
          shard.setEnabled(false);
          pillar.setEnabled(true);
          pillar.position.set(
            to.x + Math.cos(a) * radius * 0.32,
            rise / 2,
            to.z + Math.sin(a) * radius * 0.32,
          );
          pillar.scaling.set(2.2 * fade, rise, 1);
        } else if (art.particles === 'arrows' && !area && travel < 1) {
          shard.setEnabled(i === 0);
          shard.position.set(x, y, z);
          shard.rotation.set(Math.PI / 2, Math.atan2(to.x - from.x, to.z - from.z), 0);
          shard.scaling.set(1.2, 1.48 * strength, 1.2);
        } else {
          const spiral = art.particles === 'vortex' || art.particles === 'spiral';
          const sweep =
            halfAngle === undefined
              ? a + (spiral ? angle : 0)
              : Math.PI / 2 + halfAngle * ((2 * i) / (shards.length - 1) - 1);
          const spread = (area ? ringSize * 0.78 : 0.65 * strength) * (0.25 + t * 0.75);
          shard.position.set(
            x + Math.cos(sweep) * spread,
            (area ? 0.13 : y) + (spiral ? phase : Math.sin(Math.PI * t)) * strength,
            z + Math.sin(sweep) * spread,
          );
          shard.rotation.set(0, -sweep, art.particles === 'heavy' ? -1.2 : -0.48);
          shard.scaling.set(strength, (area ? 0.72 : 0.39) * strength, strength).scaleInPlace(fade);
        }
      }
    }
    return { draw, hide };
  }
  const active = new Map<number, ReturnType<typeof allocate>>();
  const pool: ReturnType<typeof allocate>[] = [];
  const drawFlyingShots = createFlyingShots(scene, (kit) => materials.get(kit)!.light);
  let match: RaidView | undefined;
  return (view: RaidView, subtick: number, outfits: readonly (string | undefined)[] = []) => {
    drawDashWind(view, subtick);
    drawTurrets(view, subtick, outfits);
    drawAirArrows(view, subtick);
    drawSwiftDagger(view, subtick);
    drawIgnition(view, subtick);
    const now = view.tick + subtick;
    drawFlyingShots(view, subtick);
    const visible = view.actions.filter((cue) => {
      const delay = contactDelay(cue);
      const contact = cue.tick + delay;
      return (
        now >= contact &&
        now - contact < lifetime(cue) &&
        now < (cue.cancelledAt ?? Infinity) &&
        !(delay && interruptedBeforeContact(view, cue, contact)) &&
        !(
          cue.hero === 'kaiken' &&
          cue.skill === 2 &&
          cue.phase === 'spin' &&
          hasBladeTrail(cue.hero)
        ) &&
        !(heroKit(cue.hero) === 'hof' && cue.skill !== 'basic') &&
        !(cue.hero === 'longshot' && cue.skill === 2) &&
        !(cue.hero === 'swift' && cue.skill === 2) &&
        !(cue.hero === 'rildin' && cue.skill === 2 && cue.phase === 'dash') &&
        !(
          cue.skill !== 'basic' &&
          appearance[heroKit(cue.hero)].spinClip ===
            (['pulse', 'bolt', 'field', 'fury'] as const)[cue.skill]
        ) &&
        !(
          cue.phase === 'dash' &&
          appearance[heroKit(cue.hero)].dashClip &&
          !appearance[heroKit(cue.hero)].dashTrail
        ) &&
        (cue.skill === 'basic' || !raidProjectileProfile(cue.hero, cue.skill))
      );
    });
    for (const [id, fx] of active) {
      if (match === view && visible.some((cue) => cue.id === id)) continue;
      fx.hide();
      pool.push(fx);
      active.delete(id);
    }
    match = view;
    for (const cue of visible) {
      const delay = contactDelay(cue);
      const contact = cue.tick + delay;
      const fx = active.get(cue.id) ?? pool.pop() ?? allocate();
      active.set(cue.id, fx);
      fx.draw(cue, now - contact, view, subtick, delay);
    }
  };
}
