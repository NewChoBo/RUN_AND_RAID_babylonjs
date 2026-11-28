import { actionLocked } from '../../../game/raid/raid-control.ts';
import { heroKit, KIT_IDS } from '../../../game/raid/heroes/hero-id.ts';
import { appearance } from './hero-appearance.ts';
import { raidProjectileProfile, raidSkill } from '../../../game/raid/heroes/hero-catalog.ts';
import { createRaidArrowRain } from './raid-arrow-rain.ts';
import { createIgnitionFx, createFlame, createFlameMaterial } from './raid-ignition.ts';
import { createRaidArrow } from './raid-arrow.ts';
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
  raidRunnerPositionAfter,
  type RaidAction,
  type RaidHero,
  type RaidView,
} from '../../../game/raid/raid-match.ts';
import { raidColors } from './raid-material.ts';

const lifetime = (cue: RaidAction) =>
  cue.skill !== 'basic' && raidAimKind(cue.hero, cue.skill) === 'field'
    ? Math.max(36, (cue.fieldTicks ?? 0) + 4)
    : cue.skill === 3
      ? 28
      : cue.skill === 'basic'
        ? 10
        : 18;
const tau = Math.PI * 2;

/** Effects sample match ticks, so pausing, catching up and starting a rematch have no independent timers. */
export function createRaidEffects(scene: Scene) {
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
    let turret: Mesh | undefined;
    let pillars: Mesh[] | undefined;
    let sectorAngle: number | undefined;
    let rain: ReturnType<typeof createRaidArrowRain> | undefined;
    let blades: ReturnType<typeof createShadowBlades> | undefined;
    let lightning: LinesMesh | undefined;
    const parts = [stamp, flare, ring, ...shards];
    function hide() {
      for (const part of parts) part.setEnabled(false);
      sector?.setEnabled(false);
      turret?.setEnabled(false);
      for (const pillar of pillars ?? []) pillar.setEnabled(false);
      rain?.hide();
      blades?.hide();
      lightning?.dispose();
      lightning = undefined;
    }
    for (const part of parts) part.isPickable = false;
    hide();
    function draw(cue: RaidAction, age: number, view: RaidView, subtick: number) {
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
      const kind = skill === 'basic' ? null : raidAimKind(hero, skill);
      const roadMotion = cue.phase === 'dash' || cue.phase === 'spin';
      const from = roadMotion ? raidGroundPointAfter(cue.from, age) : cue.from;
      const to =
        roadMotion || kind === 'field' || kind === 'leap'
          ? raidGroundPointAfter(cue.to, age)
          : cue.to;
      const t = age / lifetime(cue);
      const { sigil, light } = materials.get(heroKit(hero))!;
      if (heroKit(hero) === 'hof' && skill === 0) {
        if (!turret) {
          turret = MeshBuilder.CreateCylinder(
            'Hof frost turret',
            { height: 0.6, diameterTop: 0.52, diameterBottom: 0.82, tessellation: 8 },
            scene,
          );
          const barrel = MeshBuilder.CreateBox(
            'Frost turret barrel',
            { width: 0.19, height: 0.2, depth: 0.74 },
            scene,
          );
          barrel.parent = turret;
          barrel.position.set(0, 0.26, 0.3);
          barrel.isPickable = turret.isPickable = false;
          barrel.material = turret.material = light;
        }
        turret.setEnabled(age <= 32);
        turret.position.set(to.x, 0.32, to.z);
        turret.rotation.y = Math.sin(age * 0.14) * 0.55;
      }
      const area = kind === 'field' || kind === 'leap' || kind === 'pulse';
      const healing = kind === 'ward';
      const impactTime = area || healing || art.particles === 'heavy' ? 0 : 0.48;
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
  const bolts: Mesh[] = [];
  const crossBlades: Mesh[] = [];
  let arrowSource: Mesh | undefined;
  const arrows: Mesh[] = [];
  let match: RaidView | undefined;
  return (view: RaidView, subtick: number) => {
    drawIgnition(view, subtick);
    const now = view.tick + subtick;
    for (let i = 0; i < Math.max(arrows.length, bolts.length, view.projectiles.length); i++) {
      const p = view.projectiles[i];
      if (!p) {
        bolts[i]?.setEnabled(false);
        arrows[i]?.setEnabled(false);
        crossBlades[i]?.setEnabled(false);
        continue;
      }
      const form = appearance[heroKit(p.hero)].projectile?.[p.skill];
      const advance = Math.min(p.remaining, p.metersPerTick * subtick);
      if (form === 'arrow') {
        arrowSource ??= createRaidArrow(scene);
        const arrow = (arrows[i] ??= arrowSource.clone('raid flying arrow'));
        arrow.setEnabled(true);
        arrow.material = materials.get(heroKit(p.hero))!.light;
        arrow.position.set(p.x + p.dx * advance, 0.95, p.z + p.dz * advance);
        arrow.rotation.set(-Math.PI / 2, Math.atan2(p.dx, p.dz), 0);
        arrow.scaling.setAll(p.skill === 3 ? 1.6 : 1);
        bolts[i]?.setEnabled(false);
        crossBlades[i]?.setEnabled(false);
        continue;
      }
      arrows[i]?.setEnabled(false);
      const bolt = (bolts[i] ??= MeshBuilder.CreateSphere(
        'raid projectile',
        { diameter: 1, segments: 8 },
        scene,
      ));
      bolt.isPickable = false;
      bolt.setEnabled(true);
      const crescent = form === 'horizontal';
      bolt.position.set(p.x + p.dx * advance, crescent ? 0.36 : 1, p.z + p.dz * advance);
      bolt.rotation.y = Math.atan2(p.dx, p.dz);
      bolt.scaling.set(0.14, 0.14, p.skill === 3 ? 1.25 : 0.78);
      if (heroKit(p.hero) === 'flare' && p.skill === 0) bolt.scaling.set(0.65, 0.65, 0.85);
      if (crescent || form === 'cross') bolt.scaling.set(2.35, 0.1, 0.38);
      if (form === 'upright') bolt.scaling.set(0.16, 1.85, 0.46);
      bolt.material = materials.get(heroKit(p.hero))!.light;
      if (form === 'cross') {
        const upright = (crossBlades[i] ??= MeshBuilder.CreateSphere(
          'cross slash upright',
          { diameter: 1, segments: 8 },
          scene,
        ));
        upright.isPickable = false;
        upright.setEnabled(true);
        upright.position.copyFrom(bolt.position);
        upright.rotation.y = bolt.rotation.y;
        upright.scaling.set(0.11, 1.95, 0.38);
        upright.material = bolt.material;
      } else crossBlades[i]?.setEnabled(false);
    }
    const visible = view.actions.filter(
      (cue) =>
        now - cue.tick < lifetime(cue) &&
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
        (cue.skill === 'basic' || !raidProjectileProfile(cue.hero, cue.skill)),
    );
    for (const [id, fx] of active) {
      if (match === view && visible.some((cue) => cue.id === id)) continue;
      fx.hide();
      pool.push(fx);
      active.delete(id);
    }
    match = view;
    for (const cue of visible) {
      const fx = active.get(cue.id) ?? pool.pop() ?? allocate();
      active.set(cue.id, fx);
      fx.draw(cue, now - cue.tick, view, subtick);
    }
  };
}
