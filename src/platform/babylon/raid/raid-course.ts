import {
  Color3,
  Color4,
  DirectionalLight,
  FreeCamera,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  type StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AbstractEngine,
} from '@babylonjs/core';
import { raidMaterial } from './raid-material.ts';
import type { RaidHealthChange } from '../../../game/raid/raid-view.ts';
import { createRaidActor } from './raid-actor.ts';
import { createQuarryMarks } from './raid-quarry-mark.ts';
import { RAID_RUNNER_SCALE } from './hero-appearance.ts';
import { createRenderer } from '../rendering/renderer.ts';
import { observeRaidResolution } from './raid-resolution.ts';
import { createRaidCounterVisual } from './raid-counter-visual.ts';
import { createRaidEffects } from './raid-effects.ts';
import { hitRaidTarget, nearestRaidTarget, type RaidTargetBody } from './raid-target-pick.ts';
import { createRaidAimGuide } from './raid-aim-guide.ts';
import { pickRaidGroundAim } from './raid-ground-aim.ts';
import { createRaidCauseway } from './raid-causeway.ts';
import { createRaidHorizon } from './raid-horizon.ts';
import { loadInkApparition } from '../chapter/chapter-creatures.ts';
import { RAID_COUNTERS } from '../../../game/raid/raid-boss.ts';
import { WAGON_BODY, wagonCenter } from '../../../game/raid/wagon.ts';
import {
  RAID_BASIC_HALF_ANGLE,
  RAID_CAMERA,
  raidAimPullback,
  raidCameraPose,
} from '../../../game/raid/raid-sight.ts';
import {
  type RaidHero,
  raidBasicReach,
  raidRoadTravel,
  raidRunnerHeight,
  raidRunnerPositionAfter,
  type RaidAim,
  type RaidPoint,
  type RaidView,
  type RaidTarget,
} from '../../../game/raid/raid-match.ts';

/** The lobby can be used before a renderer or animation loop exists. */
export async function openRaidCourse(
  canvas: HTMLCanvasElement,
  fpsLimit: number | null,
  onResize: () => void,
) {
  const engine = await createRenderer(canvas, new URLSearchParams(location.search), {
    antialias: true,
  });
  engine.maxFPS = fpsLimit ?? undefined;
  try {
    observeRaidResolution(canvas, engine);
    const course = await createRaidCourse(engine, canvas);
    engine.onResizeObservable.add(onResize);
    return {
      ...course,
      startRendering: (frame: () => void) => engine.runRenderLoop(frame),
      stopRendering: (frame: () => void) => engine.stopRenderLoop(frame),
    };
  } catch (error) {
    engine.dispose();
    throw error;
  }
}

/** The course scrolls past the formation. Picking returns the same wagon-relative metres as the rules. */
async function createRaidCourse(engine: AbstractEngine, canvas: HTMLCanvasElement) {
  const scene = new Scene(engine);
  // The HUD marks claimed touches as handled. Let ordinary canvas clicks reach the course picker.
  scene.preventDefaultOnPointerDown = false;
  // Gameplay picks its own target bodies after the HUD has handled the gesture.
  scene.skipPointerMovePicking = scene.skipPointerDownPicking = scene.skipPointerUpPicking = true;
  scene.clearColor = new Color4(0.49, 0.72, 0.87, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.63, 0.72, 0.77);
  const camera = new FreeCamera('chase camera', new Vector3(0, 6.7, -12), scene);
  camera.fov = RAID_CAMERA.fov;
  camera.minZ = RAID_CAMERA.near;
  camera.maxZ = RAID_CAMERA.far;
  const fill = new HemisphericLight('canyon skylight', Vector3.Up(), scene);
  fill.diffuse = new Color3(0.85, 0.89, 0.94);
  fill.groundColor = new Color3(0.32, 0.26, 0.19);
  fill.intensity = 0.83;
  const sun = new DirectionalLight('low warm sidelight', new Vector3(0.55, -0.9, 0.32), scene);
  sun.diffuse = new Color3(1, 0.91, 0.73);
  sun.intensity = 0.93;
  const iron = raidMaterial(scene, 'tempered iron', '#424451'),
    oak = raidMaterial(scene, 'wagon oak', '#aa8263'),
    brass = raidMaterial(scene, 'bronze bands', '#cba264'),
    ember = raidMaterial(scene, 'ward amber', '#ffb355', 0.65);
  const blue = raidMaterial(scene, 'allied ward', '#61dad0', 0.65),
    red = raidMaterial(scene, 'rival ward', '#ff667a', 0.65);
  oak.diffuseTexture = new Texture('./assets/polyhaven/old_wooden_floor_01_diff_1k.jpg', scene);
  function box(
    name: string,
    parent: TransformNode | null,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: StandardMaterial,
  ) {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }
  const { ground, gate, update: drawCauseway } = createRaidCauseway(scene);
  const horizon = createRaidHorizon(scene, gate);
  const wagon = new TransformNode('siege wagon', scene);
  box('wagon bed', wagon, 0, 1.05, 0, 3.4, 0.4, 3.55, iron);
  box('wagon keep', wagon, 0, 1.95, 0, 2.88, 1.6, 3.25, oak);
  box('armored crown', wagon, 0, 2.85, 0, 3.28, 0.32, 3.6, iron);
  for (const x of [-1.25, 1.25]) {
    box('band', wagon, x, 1.98, 0, 0.18, 1.85, 3.35, brass);
    for (const z of [-1.4, 1.4]) box('crown spike', wagon, x, 3.12, z, 0.3, 0.55, 0.35, brass);
  }
  box('rear standard', wagon, 0, 1.92, -1.66, 1.25, 1.38, 0.09, red);
  const seal = box('boss seal', wagon, 0, 2.02, -1.74, 0.53, 0.53, 0.1, ember);
  seal.rotation.z = Math.PI / 4;
  const wheels: TransformNode[] = [];
  for (const side of [-1, 1])
    for (const z of [-1.13, 1.13]) {
      const pivot = new TransformNode('axle', scene);
      pivot.parent = wagon;
      pivot.position.set(side * 1.62, 0.77, z);
      wheels.push(pivot);
      const wheel = MeshBuilder.CreateTorus(
        'iron wheel',
        { diameter: 1.36, thickness: 0.21, tessellation: 18 },
        scene,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.parent = pivot;
      wheel.material = iron;
      for (const ang of [0, Math.PI / 3, (Math.PI * 2) / 3])
        box('wheel spokes', pivot, 0, 0, 0, 0.18, 1.34, 0.12, brass).rotation.x = ang;
    }
  const carriageMeshes = wagon.getChildMeshes();
  for (const mesh of carriageMeshes) mesh.overlayColor.set(1, 1, 1);
  const hull = box(
    'wagon hit volume',
    wagon,
    0,
    1.7,
    0,
    2 * WAGON_BODY.halfWidth,
    3.4,
    2 * WAGON_BODY.halfDepth,
    iron,
  );
  hull.visibility = 0;
  const wagonBody: RaidTargetBody = { target: 'wagon', meshes: [hull] };
  const bossMount = new TransformNode('wagon commander', scene);
  bossMount.parent = wagon;
  bossMount.position.set(0, 3.02, -0.35);
  let boss: Awaited<ReturnType<typeof loadInkApparition>> | undefined;
  // A missing decorative model must not prevent joining a running match.
  void loadInkApparition(scene, bossMount).then(
    (model) => {
      if (scene.isDisposed) return;
      boss = model;
      // The animated cloak and fingers share the wagon's target and one inexpensive pick volume.
      const body = box('commander hit volume', bossMount, 0, 1.28, 0, 1.55, 2.55, 0.98, iron);
      body.visibility = 0;
      wagonBody.meshes = [...wagonBody.meshes, body];
    },
    () => bossMount.setEnabled(false),
  );
  const alliedBodies: RaidTargetBody[] = [];
  const rivalBodies: RaidTargetBody[] = [];
  const shadowMat = raidMaterial(scene, 'runner contact shade', '#1a1b23');
  shadowMat.alpha = 0.55;
  const actors = new Map<RaidHero, ReturnType<typeof createRaidActor>>();
  const lightningOrb = MeshBuilder.CreateSphere(
    'Jade lightning orb',
    { diameter: 0.31, segments: 12 },
    scene,
  );
  lightningOrb.material = raidMaterial(scene, 'Jade orb light', '#8aeaff', 1);
  lightningOrb.isPickable = false;
  lightningOrb.setEnabled(false);
  const effects = createRaidEffects(
    scene,
    (hero) => actors.get(hero)?.hasBladeTrail ?? false,
    (hero) => actors.get(hero)?.dashShoulders,
  );
  const drawCounter = createRaidCounterVisual(scene);
  const lock = MeshBuilder.CreateTorus(
    'target lock',
    { diameter: 1.6, thickness: 0.09, tessellation: 28 },
    scene,
  );
  lock.material = ember;
  lock.isPickable = false;
  const callMarker = MeshBuilder.CreateLines(
    'team attack request',
    {
      points: [
        new Vector3(-0.44, 0.34, 0),
        Vector3.Zero(),
        new Vector3(0.44, 0.34, 0),
        new Vector3(0, 0.78, 0),
        new Vector3(-0.44, 0.34, 0),
      ],
    },
    scene,
  );
  callMarker.color = Color3.FromHexString('#ffd253');
  callMarker.isPickable = false;
  const drawQuarryMarks = createQuarryMarks(scene);
  // The local runner remains identifiable when a teammate overlaps the same team ring.
  const selfMark = MeshBuilder.CreateRibbon(
    'local runner chevron',
    {
      pathArray: [
        [new Vector3(-0.34, 0, -0.34), new Vector3(0, 0, -0.1), new Vector3(0.34, 0, -0.34)],
        [new Vector3(-0.34, 0, -0.53), new Vector3(0, 0, -0.29), new Vector3(0.34, 0, -0.53)],
      ],
      sideOrientation: Mesh.DOUBLESIDE,
    },
    scene,
  );
  selfMark.material = raidMaterial(scene, 'local runner ivory', '#f5ffed', 0.8);
  selfMark.scaling.setAll(RAID_RUNNER_SCALE);
  selfMark.isPickable = false;
  const edge = Array.from({ length: 33 }, (_, i) => {
    const angle = RAID_BASIC_HALF_ANGLE * (i / 16 - 1);
    return new Vector3(Math.sin(angle), 0, Math.cos(angle));
  });
  const basicRange = MeshBuilder.CreateLines(
    'basic attack range',
    { points: [Vector3.Zero(), ...edge, Vector3.Zero()] },
    scene,
  );
  basicRange.color = Color3.FromHexString('#98dccd');
  basicRange.alpha = 0.62;
  basicRange.isPickable = false;
  const drawAim = createRaidAimGuide(scene);
  let aimKind: RaidAim['kind'] | undefined;
  function showAim(aim: RaidAim | null) {
    aimKind = aim?.kind;
    canvas.classList.toggle('raid-placement-aim', aimKind === 'field' || aimKind === 'leap');
    drawAim(aim);
  }
  await scene.whenReadyAsync();
  const look = new Vector3();
  const impact = new Vector3();
  const projected = new Vector3();
  function barHeight(slot: number) {
    const runner = displayedMatch?.runners[slot];
    return (runner && actors.get(runner.hero)?.barHeight) ?? 2.2 * RAID_RUNNER_SCALE;
  }
  function projectHealthChange(change: RaidHealthChange) {
    impact.set(
      change.x,
      change.elevation +
        (change.target === 'wagon' ? 3.75 : barHeight(change.target) + 0.15 * RAID_RUNNER_SCALE),
      change.z,
    );
    // Project into the normalized canvas viewport, independently of the drawing-buffer density.
    Vector3.ProjectToRef(
      impact,
      Matrix.IdentityReadOnly,
      scene.getTransformMatrix(),
      camera.viewport,
      projected,
    );
    const { x, y, z } = projected;
    return z >= 0 && z <= 1 && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  }
  let displayedMatch: RaidView | undefined;
  function actorFor(hero: RaidHero) {
    let actor = actors.get(hero);
    if (!actor) {
      actor = createRaidActor(scene, hero, blue, red, shadowMat);
      actors.set(hero, actor);
    }
    return actor;
  }
  let pullback = 0;
  let wagonFlash = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function render(
    view: RaidView,
    dt: number,
    subtick: number,
    slot = 0,
    outfits: readonly (string | undefined)[] = [],
    waitingSeconds?: number,
  ) {
    const player = view.runners[slot]!;
    const localTeam = player.team;
    const frameTick = view.tick + subtick;
    const scroll = raidRoadTravel(frameTick);
    const carriage = wagonCenter(frameTick);
    wagon.position.set(carriage.x, 0, carriage.z);
    const lastHit = view.healthChanges.reduce(
      (tick, change) =>
        change.target === 'wagon' && change.amount < 0 ? Math.max(tick, change.tick) : tick,
      -Infinity,
    );
    const flash =
      Math.max(0, 1 - (frameTick - lastHit) / 3) * (reducedMotion.matches ? 0.22 : 0.65);
    if (wagonFlash !== flash) {
      wagonFlash = flash;
      for (const mesh of carriageMeshes) {
        mesh.renderOverlay = flash > 0;
        mesh.overlayAlpha = flash;
      }
    }
    const positions = view.runners.map((r) => raidRunnerPositionAfter(r, subtick));
    const runnerPosition = positions[player.slot]!;
    drawCauseway(runnerPosition.z, frameTick);
    horizon.position.z = runnerPosition.z;
    for (const wheel of wheels) wheel.rotation.x = scroll / 0.77;
    selfMark.setEnabled(!player.respawn && !view.result);
    selfMark.position.set(runnerPosition.x, 0.09, runnerPosition.z - 0.78 * RAID_RUNNER_SCALE);
    basicRange.setEnabled(!aimKind && !player.respawn && !view.result);
    basicRange.position.set(runnerPosition.x, 0.065, runnerPosition.z);
    basicRange.scaling.setAll(raidBasicReach(player, view.tick));
    if (displayedMatch !== view) {
      pullback = 0;
      alliedBodies.length = rivalBodies.length = 0;
      rivalBodies.push(wagonBody);
      for (const actor of actors.values()) actor.hide();
      for (const { hero, slot: target, team } of view.runners) {
        const actor = actorFor(hero);
        actor.prepareModel(outfits[target]);
        (team === localTeam ? alliedBodies : rivalBodies).push({ target, meshes: [actor.hit] });
      }
      displayedMatch = view;
    }
    for (const r of view.runners)
      actors
        .get(r.hero)!
        .draw(
          r,
          positions[r.slot]!,
          view.actions,
          view.tick,
          subtick,
          dt,
          localTeam,
          waitingSeconds,
        );
    effects(view, subtick, outfits);
    const jade = view.runners.find((r) => r.hero === 'jade' && !r.respawn);
    lightningOrb.setEnabled(!!jade);
    if (jade) {
      const carrier = view.runners[jade.lastWard ?? jade.slot]!;
      const p = positions[carrier.slot]!;
      lightningOrb.position.set(p.x, 2 + raidRunnerHeight(carrier, subtick), p.z);
    }
    drawQuarryMarks(view, positions, subtick, barHeight);
    const target =
      player.target === null
        ? null
        : player.target === 'wagon'
          ? carriage
          : positions[player.target];
    lock.setEnabled(!!target && (!aimKind || aimKind === 'field' || aimKind === 'pulse'));
    if (target) {
      lock.position.set(target.x, 0.085, target.z);
      if (player.target === 'wagon')
        lock.scaling.set((WAGON_BODY.halfWidth + 0.3) / 0.8, 1, (WAGON_BODY.halfDepth + 0.3) / 0.8);
      else lock.scaling.setAll(RAID_RUNNER_SCALE);
    }
    const call = view.calls[localTeam];
    const mark = call && 'target' in call ? call : null;
    callMarker.setEnabled(!!mark && !view.result);
    if (mark) {
      const onWagon = mark.target === 'wagon';
      const point = onWagon ? carriage : positions[mark.target]!;
      const height = onWagon
        ? boss
          ? 5.85
          : 4.4
        : barHeight(mark.target) +
          0.2 * RAID_RUNNER_SCALE +
          raidRunnerHeight(view.runners[mark.target]!, subtick);
      callMarker.position.set(
        point.x,
        height + 0.12 * Math.sin((view.tick + subtick) / 4),
        point.z,
      );
    }
    const hazard = view.hazard;
    if (boss) {
      const elapsed = hazard ? view.tick + subtick - hazard.startedAt : 0;
      const timing = hazard && RAID_COUNTERS[hazard.kind];
      const winding = !!timing && elapsed < timing.windup;
      const releasing = !!timing && elapsed < timing.windup + timing.active;
      boss.pose(dt, false, 0, {
        kind: 'ranged',
        phase: winding ? 'windup' : releasing ? 'recovery' : 'ready',
        progress: winding
          ? elapsed / timing.windup
          : releasing
            ? (elapsed - timing.windup) / timing.active
            : 0,
      });
    }
    drawCounter(hazard, subtick);
    const goal = player.respawn || view.result ? 0 : raidAimPullback(aimKind);
    // Frame-rate independent easing. Switching skills reverses from the current position.
    pullback =
      view.result || reducedMotion.matches || Math.abs(goal - pullback) < 0.01
        ? goal
        : goal + (pullback - goal) * Math.exp(-dt / 0.1);
    const pose = raidCameraPose(runnerPosition, pullback);
    // Keep the wagon readable when the runner brakes far behind it.
    const fogOffset = pullback + Math.max(0, carriage.z - runnerPosition.z - 36);
    scene.fogStart = 31 + fogOffset;
    scene.fogEnd = 115 + fogOffset;
    camera.position.copyFromFloats(pose.eye.x, pose.eye.y, pose.eye.z);
    look.set(pose.look.x, pose.look.y, pose.look.z);
    camera.setTarget(look);
    scene.render();
  }
  type ScreenPoint = Pick<PointerEvent, 'clientX' | 'clientY'>;
  function directionPoint(event: ScreenPoint): RaidPoint | null {
    const rect = canvas.getBoundingClientRect();
    const ray = scene.createPickingRay(
      event.clientX - rect.left,
      event.clientY - rect.top,
      null,
      camera,
    );
    if (ray.direction.y >= -0.00001)
      return {
        x: ray.origin.x + ray.direction.x * camera.maxZ,
        z: ray.origin.z + ray.direction.z * camera.maxZ,
      };
    const t = (1 - ray.origin.y) / ray.direction.y;
    return t < 0
      ? null
      : { x: ray.origin.x + t * ray.direction.x, z: ray.origin.z + t * ray.direction.z };
  }
  function pickTarget(
    event: ScreenPoint,
    side: 'allies' | 'enemies' | 'either',
    radius: number,
    eligible: (target: RaidTarget) => boolean,
  ) {
    const bounds = canvas.getBoundingClientRect();
    const ray = scene.createPickingRay(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      null,
      camera,
    );
    const bodies =
      side === 'either'
        ? [...rivalBodies, ...alliedBodies]
        : side === 'allies'
          ? alliedBodies
          : rivalBodies;
    const hit = hitRaidTarget(ray, ground, bodies);
    if (hit.target !== undefined && eligible(hit.target)) return hit;
    const target = nearestRaidTarget(scene, bodies, bounds, event, radius, eligible, hit.target);
    return { target, point: hit.point };
  }
  return {
    render,
    prepareRunner: (hero: RaidHero, outfit?: string) => actorFor(hero).prepareModel(outfit),
    projectHealthChange,
    placement: (event: ScreenPoint, caster: RaidPoint, range: number) =>
      pickRaidGroundAim(camera, canvas.getBoundingClientRect(), event, caster, range),
    directionPoint,
    pickTarget,
    showAim,
    cameraPosition: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
    viewAspect: () => engine.getAspectRatio(camera),
  };
}
