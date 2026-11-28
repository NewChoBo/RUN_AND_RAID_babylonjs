import {
  Color3,
  FresnelParameters,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type Scene,
} from '@babylonjs/core';
import { heroKit, type HeroKit } from '../../../game/raid/heroes/hero-id.ts';
import type { RaidView } from '../../../game/raid/raid-view.ts';
import { appearance } from './hero-appearance.ts';
import { createRaidArrow } from './raid-arrow.ts';
import { createFlyingBlade } from './raid-blade-wave.ts';
import { createDrizzHand } from './raid-drizz-hand.ts';
import { raidMaterial } from './raid-material.ts';

// The original skill icons show a dark sphere with a violet rim and a hot orange fireball.
function orbMaterial(scene: Scene, name: string, rim: string, center: string) {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.emissiveFresnelParameters = new FresnelParameters({
    leftColor: Color3.FromHexString(rim),
    rightColor: Color3.FromHexString(center),
    power: 3,
  });
  return material;
}

export function createFlyingShots(scene: Scene, light: (kit: HeroKit) => StandardMaterial) {
  const bodies: Mesh[] = [],
    arrows: Mesh[] = [];
  const waves: ReturnType<typeof createFlyingBlade>[] = [];
  const hands: ReturnType<typeof createDrizzHand>[] = [];
  let arrowSource: Mesh | undefined;
  let darkOrb: StandardMaterial | undefined,
    fireball: StandardMaterial | undefined,
    brass: StandardMaterial | undefined;

  return (view: RaidView, subtick: number) => {
    let bodyCount = 0,
      arrowCount = 0,
      waveCount = 0,
      handCount = 0;
    const active = view.projectiles,
      ended = view.endedProjectiles;
    for (let i = 0; i < active.length + ended.length; i++) {
      const p = active[i] ?? ended[i - active.length]!;
      const kit = heroKit(p.hero),
        form = appearance[kit].projectile?.[p.skill];
      const advance = Math.min(p.remaining, p.metersPerTick * subtick);
      const x = p.x + p.dx * advance,
        z = p.z + p.dz * advance,
        yaw = Math.atan2(p.dx, p.dz);
      if (form === 'horizontal' || form === 'upright' || form === 'cross') {
        const wave = (waves[waveCount++] ??= createFlyingBlade(scene));
        wave.draw(form, x, z, yaw, p.attack.flight.contact.halfWidth);
        continue;
      }
      if (form === 'arrow') {
        arrowSource ??= createRaidArrow(scene);
        const arrow = (arrows[arrowCount++] ??= arrowSource.clone('raid flying arrow'));
        arrow.setEnabled(true);
        arrow.material = light(kit);
        arrow.position.set(x, 0.95, z);
        arrow.rotation.set(-Math.PI / 2, yaw, 0);
        // Keep the shaft and arrowhead readable when the point is facing the chase camera.
        const size = p.skill === 3 ? 1.6 : 1;
        arrow.scaling.set(2.2 * size, size, 2.2 * size);
        continue;
      }
      if (form === 'hand') {
        const hand = (hands[handCount++] ??= createDrizzHand(scene));
        if (hand.draw(p.hero, x, z, yaw)) continue;
      }
      const body = (bodies[bodyCount++] ??= MeshBuilder.CreateSphere(
        'raid projectile',
        { diameter: 1, segments: 12 },
        scene,
      ));
      body.isPickable = false;
      body.setEnabled(true);
      body.position.set(x, 1, z);
      body.rotation.y = yaw;
      if (form === 'orb') {
        body.scaling.setAll(0.72);
        body.material = darkOrb ??= orbMaterial(scene, 'Abyss dark orb', '#ECB6FF', '#301445');
      } else if (form === 'fireball') {
        body.scaling.set(0.65, 0.65, 0.85);
        body.material = fireball ??= orbMaterial(scene, 'Flare fireball', '#FF6622', '#FFE99E');
      } else if (form === 'pellet' || form === 'slug') {
        const width = form === 'slug' ? 0.38 : 0.24;
        body.scaling.set(width, width, form === 'slug' ? 1.25 : 0.65);
        body.material = brass ??= raidMaterial(scene, 'Vallet shot', '#FFCE78', 0.75);
      } else {
        body.scaling.set(0.32, 0.32, 0.7);
        body.material = light(kit);
      }
    }
    for (let i = bodyCount; i < bodies.length; i++) bodies[i]!.setEnabled(false);
    for (let i = arrowCount; i < arrows.length; i++) arrows[i]!.setEnabled(false);
    for (let i = waveCount; i < waves.length; i++) waves[i]!.hide();
    for (let i = handCount; i < hands.length; i++) hands[i]!.hide();
  };
}
