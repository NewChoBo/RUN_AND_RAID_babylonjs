import { healthMeter, healthMeterPainter } from '../../../ui/raid-health-meter.ts';
import { isJetFiring } from '../../../game/raid/air-movement.ts';
import { createBladeWave } from './raid-blade-wave.ts';
import { heroKit } from '../../../game/raid/heroes/hero-id.ts';
import {
  appearance,
  RAID_MODEL_SCALE,
  RAID_RIG_SCALE,
  RAID_RUNNER_SCALE,
} from './hero-appearance.ts';
import { heroModelSource } from './hero-model-source.ts';
import { placeSourceModel } from './source-model-size.ts';
import { equipRaidGear } from './raid-equipment.ts';
import {
  Color3,
  FresnelParameters,
  DynamicTexture,
  Mesh,
  LoadAssetContainerAsync,
  MeshBuilder,
  type StandardMaterial,
  TransformNode,
  type Scene,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import { raidColors, raidMaterial } from './raid-material.ts';
import { ModelMotion } from '../actors/model-motion.ts';
import {
  raidActiveAction,
  raidFacing,
  raidSteeringFacing,
} from '../../../game/raid/raid-facing.ts';
import { RAID_JUMP_TICKS } from '../../../game/raid/runner-motion.ts';
import { RaidActionPlayback } from './raid-action-playback.ts';
import {
  RAID_HZ,
  raidRespawnTicks,
  RAID_LEAP_TICKS,
  raidRunnerHeight,
  type RaidAction,
  type RaidHero,
  type RaidPoint,
  type RaidRunner,
} from '../../../game/raid/raid-match.ts';

const clips = ['pulse', 'bolt', 'field', 'fury'] as const;

async function loadModel(scene: Scene, hero: RaidHero, rig: TransformNode, outfit?: string) {
  const source = heroModelSource(hero, outfit);
  const model = await LoadAssetContainerAsync(source.url, scene, {
    pluginOptions: { gltf: { animationStartMode: 0 } },
  });
  try {
    if (scene.isDisposed) throw new Error('Raid scene disposed');
    const motion = source.loop
      ? new ModelMotion(
          model.animationGroups,
          source.clips ?? [
            ...new Set([
              'run',
              'walk',
              'jump',
              'fall',
              'basic',
              ...clips,
              ...model.animationGroups.map((g) => g.name),
            ]),
          ],
          source.loop,
        )
      : undefined;
    model.addAllToScene();
    const root = model.meshes[0]!;
    const modelSize = source.authored ? placeSourceModel(root, source.outfitId) : undefined;
    root.parent = rig;
    if (!source.authored) {
      const meshCount = scene.meshes.length;
      const materialCount = scene.materials.length;
      const cape = model.meshes.find((m) => m.name.endsWith('_Cape') || m.name.endsWith('_Cloak'));
      if (cape)
        cape.material = raidMaterial(scene, hero + ' mantle', appearance[heroKit(hero)].cape, 0.12);
      equipRaidGear(scene, hero, model.transformNodes, cape ?? rig);
      model.meshes.push(...scene.meshes.slice(meshCount));
      model.materials.push(...scene.materials.slice(materialCount));
    }
    for (const mesh of rig.getChildMeshes()) mesh.isPickable = false;
    // Rildin's default run repeats in about 0.70 s in match footage (see ORIGINAL-ROSTER).
    const runCycle =
      hero === 'rildin' && (!outfit || outfit === 'rildin/default') ? 0.7 : undefined;
    return { model, motion, modelSize, runCycle };
  } catch (error) {
    model.dispose();
    throw error;
  }
}

export function createRaidActor(
  scene: Scene,
  hero: RaidHero,
  blue: StandardMaterial,
  red: StandardMaterial,
  shadowMat: StandardMaterial,
) {
  const art = appearance[heroKit(hero)];
  const root = new TransformNode(hero + ' runner', scene);
  const body = new TransformNode(hero + ' body', scene);
  body.parent = root;
  body.scaling.setAll(RAID_RUNNER_SCALE);
  const rig = new TransformNode(hero + ' facing', scene);
  rig.parent = body;
  rig.scaling.setAll(RAID_RIG_SCALE);
  // The moving hand, cape and weapon do not change the touch target's size.
  const capsuleHeight = 1.86;
  const hit = MeshBuilder.CreateCapsule(
    hero + ' body target',
    { height: capsuleHeight, radius: 0.42 },
    scene,
  );
  hit.parent = body;
  hit.position.y = capsuleHeight / 2;
  let motion: ModelMotion | undefined;
  let playback = new RaidActionPlayback();
  let greatsword: TransformNode | undefined;
  let current: Awaited<ReturnType<typeof loadModel>> | undefined;
  let requested: string | undefined;
  let generation = 0;
  let loading: Promise<void> | undefined;
  // The team-colored body remains visible and pickable until its model is ready.
  function prepareModel(outfit?: string) {
    if ((current || loading) && requested === outfit) return loading;
    const version = ++generation;
    current?.model.dispose();
    current = undefined;
    motion = undefined;
    playback = new RaidActionPlayback();
    greatsword = undefined;
    hit.visibility = 1;
    hit.scaling.setAll(1);
    hit.position.y = capsuleHeight / 2;
    ward.parent = body;
    ward.position.y = 0.99;
    ward.scaling.set(1, 1.39, 1);
    bar.position.y = defaultBarHeight;
    requested = outfit;
    loading = loadModel(scene, hero, rig, outfit).then(
      (loaded) => {
        if (version !== generation) {
          loaded.model.dispose();
          return;
        }
        current = loaded;
        motion = loaded.motion;
        const size = loaded.modelSize;
        if (size) {
          const height = size.y * rig.scaling.y;
          bar.position.y = height * RAID_RUNNER_SCALE + 0.26;
          const touchHeight = Math.max(capsuleHeight, height);
          hit.scaling.setAll(touchHeight / capsuleHeight);
          hit.position.y = touchHeight / 2;
          ward.parent = rig;
          ward.position.y = size.y / 2;
          ward.scaling
            .set(Math.max(size.x, size.y * 0.6), size.y, Math.max(size.z, size.y * 0.6))
            .scaleInPlace(1.15 / wardDiameter);
        } else bar.position.y = defaultBarHeight * RAID_MODEL_SCALE;
        loading = undefined;
        if (art.empoweredMesh)
          greatsword = rig.getChildMeshes().find((mesh) => mesh.name === art.empoweredMesh);
        hit.visibility = 0;
      },
      (error: unknown) => {
        if (version !== generation) return;
        loading = undefined;
        if (!scene.isDisposed) console.warn('Could not load raid model', hero, error);
      },
    );
    return loading;
  }
  const ring = MeshBuilder.CreateTorus(
    hero + ' team marking',
    { diameter: 1.18, thickness: 0.07, tessellation: 28 },
    scene,
  );
  ring.scaling.setAll(RAID_RUNNER_SCALE);
  const spinTrail = art.spinClip
    ? MeshBuilder.CreateTorus(
        hero + ' moving sweep',
        { diameter: 2, thickness: 0.025, tessellation: 64 },
        scene,
      )
    : null;
  if (spinTrail) {
    spinTrail.parent = root;
    spinTrail.position.y = 0.25;
    spinTrail.material = raidMaterial(scene, hero + ' sweep light', raidColors[heroKit(hero)], 0.8);
    spinTrail.isPickable = false;
    spinTrail.setEnabled(false);
  }
  const shadow = MeshBuilder.CreateDisc(
    hero + ' foot contact',
    { radius: 0.5, tessellation: 18 },
    scene,
  );
  shadow.rotation.x = Math.PI / 2;
  shadow.scaling.setAll(RAID_RUNNER_SCALE);
  shadow.material = shadowMat;
  const bar = MeshBuilder.CreatePlane(hero + ' health', { width: 1.48, height: 0.22 }, scene);
  bar.parent = root;
  bar.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const defaultBarHeight = (art.barHeight ?? 2.2) * RAID_RUNNER_SCALE;
  bar.position.y = defaultBarHeight;
  const texture = new DynamicTexture(
    hero + ' health meter',
    { width: 256, height: 32 },
    scene,
    false,
  );
  texture.hasAlpha = true;
  const material = raidMaterial(scene, hero + ' health meter', '#ffffff');
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.backFaceCulling = false;
  bar.material = material;
  const paintHp = healthMeterPainter(texture.getContext(), 256, 32);
  const wardDiameter = 1.5;
  const ward = MeshBuilder.CreateSphere(
    hero + ' ward',
    { diameter: wardDiameter, segments: 14 },
    scene,
  );
  ward.parent = body;
  ward.position.y = 0.99;
  ward.scaling.y = 1.39;
  const shield = raidMaterial(scene, hero + ' ward glow', '#78a7ff', 0.8);
  ward.material = shield;
  ward.isPickable = false;
  shield.opacityFresnelParameters = new FresnelParameters({
    leftColor: Color3.Black(),
    rightColor: Color3.FromHexString('#afafaf'),
    power: 2,
  });
  shield.alpha = 0.13;
  const spinTrails =
    hero === 'kaiken' || hero === 'hammer'
      ? [-1, 1].map((side) => {
          const trail = createBladeWave(
            scene,
            hero + ' spinning weapon trail',
            hero === 'hammer' ? new Color3(1, 0.73, 0.32) : new Color3(0.65, 0.91, 1),
          );
          trail.parent = root;
          trail.isPickable = false;
          trail.setEnabled(false);
          return { trail, side };
        })
      : [];
  const exhaust =
    hero === 'hof'
      ? MeshBuilder.CreateCylinder(
          'Hof jet exhaust',
          { height: 0.85, diameterTop: 0.24, diameterBottom: 0, tessellation: 12 },
          scene,
        )
      : undefined;
  if (exhaust) {
    exhaust.parent = body;
    exhaust.position.set(0, 0.47, -0.24);
    exhaust.isPickable = false;
    exhaust.material = raidMaterial(scene, 'jet flame', '#7bdcff', 1);
    exhaust.setEnabled(false);
  }
  const orb =
    hero === 'alice'
      ? MeshBuilder.CreateSphere('Holy Orb', { diameter: 0.36, segments: 12 }, scene)
      : undefined;
  if (orb) {
    orb.parent = root;
    orb.isPickable = false;
    orb.material = raidMaterial(scene, 'Holy Orb light', raidColors.alice, 0.95);
    orb.setEnabled(false);
  }
  for (const part of [shadow, ring, bar, ward]) part.isPickable = false;
  function hide() {
    playback = new RaidActionPlayback();
    root.setEnabled(false);
    shadow.setEnabled(false);
    ring.setEnabled(false);
  }
  hide();
  function draw(
    r: RaidRunner,
    position: RaidPoint,
    actions: readonly RaidAction[],
    tick: number,
    subtick: number,
    dt: number,
    localTeam = 0,
    waitingSeconds?: number,
    startSide = 0,
  ) {
    const now = tick + subtick;
    if (orb) {
      orb.setEnabled(!r.respawn && !!r.heroView.orbTicks);
      orb.position.set(
        Math.cos(now * 0.08) * 0.56,
        1.5 + 0.12 * Math.sin(now * 0.12),
        Math.sin(now * 0.08) * 0.56,
      );
    }
    spinTrail?.setEnabled(r.spinTicks > 0 && !r.respawn);
    if (spinTrail && r.spin) spinTrail.scaling.set(r.spin.radius, 1, r.spin.radius);
    const fallAge = raidRespawnTicks(r.deaths) - r.respawn;
    const concealed = r.team !== localTeam && (r.heroView.concealedUntil ?? 0) > tick;
    root.setEnabled(
      !concealed && (!r.respawn || fallAge < (motion?.duration('fall') || 0.6) * RAID_HZ),
    );
    hit.setEnabled(!r.respawn && !concealed);
    hit.material = ring.material = r.team === localTeam ? blue : red;
    ring.setEnabled(!r.respawn && !concealed);
    shadow.setEnabled(root.isEnabled());
    if (!root.isEnabled()) return;
    bar.setEnabled(!r.respawn);
    const vitals = healthMeter(r, tick);
    ward.setEnabled(vitals.reducedDamage || vitals.barrier > 0 || vitals.guarding);
    if (exhaust) {
      exhaust.setEnabled(isJetFiring(r) && !r.respawn);
      exhaust.scaling.y = 0.95 + 0.18 * Math.sin((tick + subtick) * 1.7);
    }
    for (const { trail, side } of spinTrails) {
      trail.setEnabled(!!r.spin && !r.respawn);
      if (r.spin) {
        const phase =
          ((r.spin.duration - r.spin.remaining + subtick) * Math.PI * 2) / r.spin.interval +
          (side < 0 ? Math.PI : 0);
        trail.rotation.set(0.08, phase, side * 0.16);
        trail.position.set(1.2 * Math.sin(phase), 0.82 + side * 0.1, 1.2 * Math.cos(phase));
        trail.scaling.set(1.65, 1, 0.9);
      }
    }
    const { x, z } = position;
    const elevation = raidRunnerHeight(r, subtick);
    root.position.set(x, elevation, z);
    ring.position.set(x, 0.055, z);
    shadow.position.set(x, 0.032, z);
    if (paintHp(vitals, r.team === localTeam)) texture.update();
    rig.rotation.z = 0.26 * Math.min(1, Math.max(r.staggered, r.stunned) / 4);
    if (!current) return;
    if (greatsword) greatsword.scaling.setAll((r.heroView.empoweredUntil ?? 0) > tick ? 1.45 : 1);
    if (waitingSeconds !== undefined) {
      rig.rotation.y = raidSteeringFacing(startSide);
      if (motion?.has('idle')) motion.loop('idle', waitingSeconds, dt);
      else if (hero === 'bird') motion?.loop('run', waitingSeconds, dt);
      else motion?.seek('run', 0, dt);
      return;
    }
    if (r.respawn) {
      motion?.once('fall', (fallAge + subtick) / RAID_HZ, dt);
      return;
    }
    if ((r.staggered || r.stunned) && !r.leap && !r.jumping) {
      motion?.seek('fall', 0.13, dt);
      return;
    }
    const active = raidActiveAction(actions, r.slot, now);
    // Partial rigs reuse their own attack or locomotion take at its authored speed.
    const actionClip = (name: string) =>
      motion?.has(name) ? name : motion?.has('basic') ? 'basic' : 'run';
    const modeClip = (alternate: string, normal: string) =>
      r.heroView.shieldMode && motion?.has(alternate) ? alternate : normal;
    const pose = playback.update(actions, r.slot, now, (cue) => {
      let clip: string =
        cue.skill === 'basic' ? modeClip('shieldBasic', 'basic') : clips[cue.skill];
      if (hero === 'hof' && cue.skill !== 'basic') clip = 'pulse';
      if (cue.comboStep && cue.comboStep > 1 && motion?.has('slash' + cue.comboStep))
        clip = 'slash' + cue.comboStep;
      if (cue.phase === 'spin' && hero === 'kaiken' && motion?.has('fullMoonEnd'))
        clip = 'fullMoonEnd';
      if (cue.phase === 'dash' && hero === 'magnus') clip = modeClip('shieldCharge', 'pulse');
      const start =
        art.landingChop && cue.skill === 1 && cue.phase === 'ground'
          ? cue.tick - RAID_LEAP_TICKS
          : cue.tick;
      clip = actionClip(clip);
      return { clip, duration: motion?.duration(clip) ?? 0, start };
    });
    const facing = raidFacing(r, pose?.cue ?? active);
    if (r.leap) {
      motion?.once(actionClip(clips[r.leap.skill]), (r.leap.elapsed + subtick) / RAID_HZ, dt);
    } else if (r.dash) {
      const clip = r.heroView.shieldMode
        ? modeClip('shieldCharge', clips[r.dash.skill])
        : clips[r.dash.skill];
      motion?.once(actionClip(clip), (r.dash.elapsed + subtick) / RAID_HZ, dt);
    } else if (r.heroView.rootedTicks && r.heroView.rootDuration) {
      motion?.once(
        motion.has('fullMoonEnd') ? 'fullMoonEnd' : 'field',
        (r.heroView.rootDuration - r.heroView.rootedTicks + subtick) / RAID_HZ,
        dt,
      );
    } else if (r.spin) {
      motion?.loop(
        clips[r.spin.skill],
        (r.spin.duration - r.spin.remaining + subtick) / RAID_HZ,
        dt,
      );
    } else if (
      r.air &&
      (!pose || pose.cue.skill === 'basic') &&
      r.air.second &&
      motion?.has('airJump')
    ) {
      motion.once('airJump', (r.air.elapsed + subtick) / RAID_HZ, dt);
    } else if (
      r.air &&
      (!pose || pose.cue.skill === 'basic') &&
      r.jetFuel !== undefined &&
      motion?.has('jetRise')
    ) {
      motion.loop(
        r.air.speed >= 0 ? 'jetRise' : 'jetFall',
        (r.air.elapsed + subtick) / RAID_HZ,
        dt,
      );
    } else if (pose && !(hero === 'longshot' && pose.cue.skill === 2)) {
      motion?.once(pose.clip, ((now - pose.start) / RAID_HZ) * (pose.cue.basicSpeed ?? 1), dt);
    } else if (r.jumping)
      motion?.once(
        modeClip('shieldJump', 'jump'),
        r.air
          ? Math.min(r.air.elapsed + subtick, RAID_JUMP_TICKS - 1) / RAID_HZ
          : ((r.launchDuration || (r.heroView.escapeTicks ? 2 * RAID_HZ : RAID_JUMP_TICKS)) -
              r.jumping +
              subtick) /
              RAID_HZ,
        dt,
      );
    else if (r.heroView.orbTicks && motion?.has('orbLoop')) {
      const elapsed = (5 * RAID_HZ - r.heroView.orbTicks + subtick) / RAID_HZ;
      motion.loop('orbLoop', Math.max(0, elapsed - motion.duration('fury')), dt);
    } else {
      const gait = modeClip('shieldRun', r.slowed || r.appliedBrake >= 0.5 ? 'walk' : 'run');
      motion?.gait(
        gait,
        now / RAID_HZ + r.slot * 0.13,
        dt,
        gait === 'run' ? current.runCycle : undefined,
      );
    }
    const turn = facing - rig.rotation.y;
    rig.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 20);
  }
  return {
    draw,
    hide,
    prepareModel,
    hit,
    get barHeight() {
      return bar.position.y;
    },
  };
}
