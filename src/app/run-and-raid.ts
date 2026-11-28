import { canPressJump } from '../game/raid/air-movement.ts';
import { RaidRound } from '../game/raid/raid-round.ts';
import { raidSkill } from '../game/raid/heroes/hero-catalog.ts';
import type { RaidEntry, RaidRoom, RoomError } from '../platform/photon/raid-room.ts';
import { createRaidLobby } from '../ui/raid-lobby.ts';
import { raidText } from '../content/locales/run-and-raid.ts';
import {
  RaidMatch,
  RAID_HZ,
  canUseRaidSkill,
  raidRunnerAimKind,
  raidRunnerHeight,
  type RaidHero,
  type Skill,
  type RaidTarget,
} from '../game/raid/raid-match.ts';
import { practiceRoster } from '../game/raid/raid-draft.ts';
import type { RaidRageLoadout } from '../content/raid/rage.ts';
import type { RaidCommandName } from '../game/raid/raid-feature.ts';
import { RaidSimulation } from '../game/raid/raid-simulation.ts';
import type { openRaidCourse } from '../platform/babylon/raid/raid-course.ts';
import { createPreferences } from '../platform/browser/preferences.ts';
import { createRaidAudio } from '../platform/browser/raid-audio.ts';
import { createRaidHud } from '../ui/raid-hud.ts';
import {
  RAID_AIM_RADIUS,
  type AimPoint,
  type RaidAimFeedback,
  type RaidAimInput,
} from '../ui/raid-aim-pad.ts';
import { playableViewport } from '../ui/viewport-limit.ts';
import { closeLoadingScreen, showArenaLoading } from '../ui/loading-screen.ts';

const startDelayMs = 3000;

export function prepareRaid(showStartupError: (error: unknown) => void) {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  let course: Awaited<ReturnType<typeof openRaidCourse>>;
  const device = createPreferences();
  const preferences = device.get();
  const audio = createRaidAudio();
  // Touch browsers grant audio activation on release. Online starts arrive later from the room.
  document.addEventListener('pointerup', audio.unlock, true);
  document.addEventListener('keydown', audio.unlock, true);

  let chosenHero: RaidHero = 'hammer';
  let offline = false;
  let offlinePick: RaidHero | null = null;
  let soloOutfit: string | undefined;
  let soloRageLoadout: RaidRageLoadout | undefined;
  let matchOutfits: (string | undefined)[] = [];
  canvas.setAttribute('aria-label', raidText('canvas'));
  let match: RaidMatch, solo: RaidSimulation;
  let slot = 0;
  let room: RaidRoom | undefined;
  let round: RaidRound | undefined;
  let attempt = 0;
  let timer: number | undefined;
  let onlineStart = 0;
  let lastFrameAt = 0;
  let onlineRespawning = false;
  let state: 'setup' | 'loading' | 'countdown' | 'playing' | 'paused' | 'finished' = 'setup';
  let countdownMs = 0;
  let aiming: Skill | null = null;
  let carry = 0,
    previous = 0,
    lastHudTick = -1;
  const pressed = new Map<string, string>();
  let keyboardAimPoint: AimPoint | null = null;
  let padSide = 0,
    padBrake = 0;
  const order = (action: RaidCommandName, payload?: unknown) =>
    room ? room.order(action, payload) : solo.dispatch(slot, action, payload);
  function steering() {
    const actions = [...pressed.values()];
    const side = padSide + Number(actions.includes('right')) - Number(actions.includes('left'));
    return {
      side: Math.max(-1, Math.min(1, side)),
      brake: actions.includes('walk') ? 1 : padBrake,
    };
  }
  function move() {
    if (state === 'playing' || (state === 'countdown' && room)) order('move', steering());
  }
  function held(action: string, down: boolean, source: string) {
    if (state !== 'playing' && state !== 'countdown') return;
    if (down) pressed.set(source, action);
    else pressed.delete(source);
    move();
  }
  function cast(skill: Skill) {
    if (state !== 'playing') return;
    aimPointer = null;
    hud.aimPad.close();
    course.showAim(null);
    const r = match.runners[slot]!;
    const kind = raidRunnerAimKind(r, skill);
    if (kind !== 'pulse') {
      aiming = aiming !== skill && canUseRaidSkill(r, skill) ? skill : null;
    } else {
      aiming = null;
      order('cast', { skill });
    }
    hud.update(match, aiming, slot);
    if (aiming !== null) refreshKeyboardAim();
  }
  function cycle() {
    if (state !== 'playing') return;
    const options = (['wagon', ...match.runners.map((r) => r.slot)] as RaidTarget[]).filter(
      (target) => match.canTarget(slot, target),
    );
    if (!options.length) return;
    const current = match.runners[slot]!.target;
    const next = current === null ? 0 : (options.indexOf(current) + 1) % options.length;
    order('lock', options[next]!);
    hud.update(match, aiming, slot);
  }
  function callTarget() {
    if (state !== 'playing') return;
    const r = match.runners[slot]!;
    if (r.target !== null && match.canTarget(slot, r.target)) order('call', r.target);
  }
  function repeatCast(skill: Skill) {
    if (state !== 'playing') return;
    if (raidRunnerAimKind(match.runners[slot]!, skill) === 'pulse') return;
    const preview = match.previewRepeat(slot, skill);
    aiming = null;
    aimPointer = null;
    hud.aimPad.close();
    course.showAim(null);
    if (preview?.status === 'ready') order('cast', { skill, repeat: true });
    else hud.showFeedback(raidText(preview ? 'repeatUnavailable' : 'repeatMissing'));
    hud.update(match, null, slot);
  }
  const jetInputs = new Set<'key' | 'pad'>();
  function evade(down?: boolean, source: 'key' | 'pad' = 'pad') {
    if (down === false) {
      if (jetInputs.delete(source) && !jetInputs.size && state === 'playing') order('jump', false);
      return;
    }
    if (state !== 'playing') return;
    const r = match.runners[slot]!;
    if (!canPressJump(r)) return;
    const jet = down === true && r.jetFuel !== undefined;
    if (jet) jetInputs.add(source);
    aimPointer = null;
    aiming = null;
    hud.aimPad.close();
    course.showAim(null);
    order('jump', jet ? true : undefined);
    hud.update(match, null, slot);
  }
  function enterCourse() {
    audio.unlock();
    state = countdownMs > 0 ? 'countdown' : 'playing';
    hud.play(Math.ceil(countdownMs / 1000));
    canvas.inert = false;
    canvas.focus({ preventScroll: true });
    course.startRendering(renderFrame);
  }
  function resume() {
    if (!playableViewport.matches) return;
    if (state === 'paused') audio.skipPast(match);
    previous = performance.now();
    if (round) countdownMs = Math.max(0, onlineStart - previous);
    enterCourse();
  }
  function pause() {
    if (state !== 'playing' && state !== 'countdown') return;
    if (jetInputs.size) order('jump', false);
    jetInputs.clear();
    pressed.clear();
    padSide = 0;
    padBrake = 0;
    if (state === 'countdown')
      countdownMs = Math.max(0, countdownMs - (performance.now() - previous));
    move();
    aiming = null;
    course.showAim(null);
    state = 'paused';
    audio.suspend();
    course.stopRendering(renderFrame);
    hud.showPanel(null, slot, !!round);
    canvas.inert = true;
  }
  function finishMatch() {
    if (state === 'finished') return;
    const renderFinalFrame = state !== 'paused' && !document.hidden;
    state = 'finished';
    clearInterval(timer);
    course.stopRendering(renderFrame);
    jetInputs.clear();
    pressed.clear();
    aiming = null;
    aimPointer = null;
    keyboardAimPoint = null;
    canvas.inert = true;
    hud.showPanel(match, slot, !!round, matchOutfits);
    if (renderFinalFrame) {
      renderCourse(0, 0);
      audio.update(match, slot);
    }
  }
  // Prepare the arena before joining Photon so renderer startup cannot delay an online round.
  let preparing: Promise<void> | undefined;
  async function prepareCourse(prepareModels?: () => Promise<unknown>) {
    if (course && !prepareModels) return true;
    const token = attempt;
    state = 'loading';
    showArenaLoading(() => resetLobby());
    try {
      if (!course)
        await (preparing ??= loadCourse().finally(() => {
          preparing = undefined;
        }));
      if (token !== attempt) return false;
      await prepareModels?.();
      return token === attempt;
    } catch (error) {
      if (token === attempt) {
        resetLobby();
        showStartupError(error);
      }
      return false;
    } finally {
      if (token === attempt) {
        closeLoadingScreen();
        state = 'setup';
      }
    }
  }
  async function loadCourse() {
    const { openRaidCourse } = await import('../platform/babylon/raid/raid-course.ts');
    course = await openRaidCourse(canvas, preferences.fpsLimit, () => {
      keyboardAimPoint = null;
      hud.aimPad.close();
    });
  }
  function begin() {
    if (room || !playableViewport.matches || (state !== 'setup' && state !== 'finished')) return;
    return launchSolo();
  }
  async function launchSolo() {
    const roster = practiceRoster(chosenHero);
    const ready = await prepareCourse(() =>
      Promise.all(
        roster.map((hero, i) => course.prepareRunner(hero, i === 0 ? soloOutfit : undefined)),
      ),
    );
    if (!ready) return;
    slot = 0;
    matchOutfits = [soloOutfit];
    match = new RaidMatch(roster, course.viewAspect, [soloRageLoadout ?? {}]);
    solo = new RaidSimulation(match, new Set([slot]));
    launch();
  }
  function launch() {
    audio.reset();
    lobby.closePicker();
    pressed.clear();
    padSide = 0;
    padBrake = 0;
    aiming = null;
    carry = 0;
    course.showAim(null);
    lastHudTick = -1;
    countdownMs = startDelayMs;
    document.getElementById('overlay')!.hidden = true;
    hud.update(match, null, slot);
    renderCourse(0, 0, 0);
    if (playableViewport.matches) resume();
    else {
      state = 'paused';
      hud.showPanel(null, slot, !!round);
    }
  }
  const { left, right, back, jump } = preferences.bindings;
  function refreshKeyboardAim() {
    const pointer = keyboardAimPoint ?? {
      clientX: canvas.clientWidth / 2,
      clientY: canvas.clientHeight / 2,
    };
    if (aiming === null) return;
    hud.showSkillAim(previewSkill(aiming, pointer));
  }
  function pickSkill(skill: Skill, event: RaidAimInput): RaidAimFeedback {
    const runner = match.runners[slot]!;
    const kind = raidRunnerAimKind(runner, skill);
    if ('dx' in event) {
      return match.previewSkill(slot, skill, { x: runner.x + event.dx, z: runner.z + event.dz });
    }
    if (kind === 'direction') return match.previewSkill(slot, skill, course.directionPoint(event));
    const rule = raidSkill(runner.hero, skill);
    if (kind === 'field' || kind === 'leap') {
      const { point, limitedCursor } = course.placement(
        event,
        runner,
        match.skillRange(slot, skill).range,
      );
      return { ...match.previewSkill(slot, skill, point), limitedCursor };
    }
    if (kind === 'pulse') return match.previewSkill(slot, skill, null);
    const eligible = (id: RaidTarget) =>
      match.previewSkill(slot, skill, null, id).status === 'ready';
    const side =
      kind === 'ward' ? 'allies' : rule.kind === 'target' && rule.allowAlly ? 'either' : 'enemies';
    const hit = course.pickTarget(event, side, RAID_AIM_RADIUS, eligible);
    return match.previewSkill(slot, skill, hit.point, hit.target);
  }
  function drop(skill: Skill, event: RaidAimInput) {
    if (state !== 'playing') return;
    const hit = pickSkill(skill, event);
    if (hit.status !== 'ready') return;
    const payload =
      hit.kind === 'direction' && hit.point
        ? { skill, dx: hit.point.x - hit.origin.x, dz: hit.point.z - hit.origin.z }
        : hit.kind === 'field' || hit.kind === 'leap'
          ? { skill, ...hit.point }
          : hit.kind === 'pulse'
            ? { skill }
            : hit.kind === 'ward'
              ? { skill, ally: hit.target }
              : { skill, target: hit.target };
    if (!order('cast', payload)) return;
    aiming = null;
    hud.update(match, null, slot);
  }
  function previewSkill(skill: Skill, event: RaidAimInput) {
    const aim = pickSkill(skill, event);
    course.showAim(aim);
    return {
      ...aim,
      targetName: typeof aim.target === 'number' ? match.runners[aim.target]!.hero : aim.target,
    };
  }
  const hud = createRaidHud(
    {
      steer(side, brake) {
        if (state !== 'playing' && state !== 'countdown') return;
        if (padSide === side && padBrake === brake) return;
        padSide = side;
        padBrake = brake;
        move();
      },
      clearPreview: () => course.showAim(null),
      beginPadAim: () => {
        aiming = null;
        hud.update(match, null, slot);
      },
      preview: previewSkill,
      jump: evade,
      repeatCast,
      ping(intent) {
        if (state === 'playing' && aiming === null && hud.aimPad.skill === null)
          order('call', intent);
      },
      drop,
      skill: cast,
      target: cycle,
      pause,
      resume,
      retry: begin,
      leave: () => {
        location.hash = '/home';
      },
      setHudPreference: (key, value) => device.set({ ...device.get(), [key]: value }),
    },
    canvas,
    preferences,
  );
  function drawOffline() {
    lobby.room(
      '',
      [{ actor: 1, hero: offlinePick, outfit: soloOutfit, rageLoadout: soloRageLoadout }],
      1,
      true,
      null,
      true,
    );
  }
  const lobby = createRaidLobby(document.querySelector<HTMLElement>('#menu-actions')!, {
    connect: (code, entry) => void connect(code, entry),
    practice() {
      offline = true;
      offlinePick = null;
      soloOutfit = undefined;
      soloRageLoadout = undefined;
      drawOffline();
    },
    start() {
      if (offline && offlinePick) {
        chosenHero = offlinePick;
        void begin();
      } else room?.start();
    },
    pick(hero, outfit, rageLoadout) {
      if (offline) {
        offlinePick = hero;
        soloOutfit = outfit;
        soloRageLoadout = rageLoadout;
        drawOffline();
      } else room?.pick(hero, outfit, rageLoadout);
    },
    selected: () => chosenHero,
    prefer: (hero, outfit, rageLoadout) => room?.prefer(hero, outfit, rageLoadout),
    chat(text) {
      if (offline) lobby.chat(1, text);
      else room?.chat(text);
    },
    leave: () => resetLobby(),
  });
  function resetLobby(reason?: RoomError, exiting = false) {
    jetInputs.clear();
    audio.suspend();
    attempt++;
    if (state === 'loading') closeLoadingScreen();
    clearInterval(timer);
    room?.close();
    room = undefined;
    round = undefined;
    state = 'setup';
    slot = 0;
    aiming = null;
    pressed.clear();
    hud.reset();
    course?.stopRendering(renderFrame);
    course?.showAim(null);
    offline = false;
    offlinePick = null;
    canvas.inert = true;
    document.getElementById('overlay')!.hidden = false;
    if (exiting) lobby.close();
    else lobby.reset(reason);
  }
  async function connect(code: string, entry: RaidEntry) {
    if (state !== 'setup' || room) return;
    const token = ++attempt;
    lobby.pending(entry);
    if (!(await prepareCourse()) || token !== attempt) return;
    try {
      const id = import.meta.env.VITE_PHOTON_APP_ID;
      if (!id) throw new Error('Missing Photon App ID');
      const { RaidRoom } = await import('../platform/photon/raid-room.ts');
      if (token !== attempt) return;
      room = new RaidRoom(id, code, entry, {
        waiting: (count) => lobby.waiting(count),
        chat: (actor, text) => lobby.chat(actor, text),
        lobby(seats, self, host, clock) {
          for (const seat of seats) if (seat.hero) course.prepareRunner(seat.hero, seat.outfit);
          lobby.room(code, seats, self, host, clock);
        },
        solo(hero, outfit, rageLoadout) {
          room = undefined;
          chosenHero = hero;
          soloOutfit = outfit;
          soloRageLoadout = rageLoadout;
          void launchSolo();
        },
        start(seats, self, host) {
          round = new RaidRound(seats);
          matchOutfits = [];
          for (const seat of seats) matchOutfits[round.slot(seat.actor)!] = seat.outfit;
          slot = round.slot(self)!;
          match = round.match;
          onlineStart = performance.now() + startDelayMs;
          lastFrameAt = onlineStart;
          onlineRespawning = false;
          launch();
          // Keep the authoritative clock independent of rendering, focus and local menus.
          timer = window.setInterval(() => {
            if (!room || !round) return;
            const now = performance.now();
            if (!host) {
              if (now - lastFrameAt > 20000) room.fail('connectError');
              return;
            }
            const due = Math.floor(((now - onlineStart) * RAID_HZ) / 1000) - match.tick;
            let ticks = Math.min(due, RAID_HZ * 2);
            while (ticks > 0 && !match.result) {
              const n = Math.min(6, ticks);
              room.frames(round.advance(n));
              ticks -= n;
            }
            lastFrameAt = onlineStart + (match.tick * 1000) / RAID_HZ;
            if (match.result) finishMatch();
          }, 1000 / RAID_HZ);
        },
        intent(sender, data) {
          round?.enqueue(sender, data, performance.now() < onlineStart);
        },
        frames(data) {
          lastFrameAt = performance.now();
          if (!round?.replay(data)) room?.fail('syncError');
          else if (match.result) finishMatch();
        },
        closed(reason) {
          if (round?.match.result) finishMatch();
          else resetLobby(reason);
        },
      });
    } catch {
      if (token === attempt) resetLobby('connectError');
    }
  }
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    if (room || offline || state === 'loading') resetLobby();
    else attempt++;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    keyboardAimPoint = { clientX: e.clientX, clientY: e.clientY };
    if (aiming !== null) refreshKeyboardAim();
  });
  Object.defineProperty(window, '__ROOM_DEMO__', {
    value: Object.freeze({
      snapshot: () => ({
        ready: true,
        started: state !== 'setup' && state !== 'loading',
        paused: state === 'paused',
        raid: state !== 'setup' &&
          state !== 'loading' &&
          match && {
            tick: match.tick,
            slot,
            online: !!round,
            hero: match.runners[slot]!.hero,
            health: match.runners.map((r) => r.hp),
            deaths: match.runners.map((r) => r.deaths),
            camera: course.cameraPosition(),
            damage: [...match.damage],
            position: {
              x: match.runners[slot]!.x,
              z: match.runners[slot]!.z,
              height: raidRunnerHeight(match.runners[slot]!),
            },
            movement: { side: match.runners[slot]!.side, brake: match.runners[slot]!.brake },
          },
      }),
    }),
  });
  let aimPointer: number | null = null;
  canvas.addEventListener('pointercancel', () => {
    aimPointer = null;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (aimPointer !== e.pointerId) return;
    aimPointer = null;
    if (state !== 'playing' || aiming === null) return;
    drop(aiming, e);
    if (aiming === null) course.showAim(null);
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'playing' || e.defaultPrevented || hud.aimPad.skill !== null || e.button !== 0)
      return;
    if (aiming !== null) {
      aimPointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const { target } = course.pickTarget(e, 'enemies', RAID_AIM_RADIUS, (id) =>
      match.canTarget(slot, id),
    );
    if (target !== undefined) order('lock', target);
    hud.update(match, aiming, slot);
  });
  const moves = new Map([
    [left, 'left'],
    [right, 'right'],
    [back, 'walk'],
  ]);
  window.addEventListener('keydown', (e) => {
    if (
      state !== 'playing' &&
      state !== 'countdown' &&
      !(state === 'paused' && e.code === 'Escape')
    )
      return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = moves.get(e.code);
    if (action) {
      e.preventDefault();
      if (!e.repeat) held(action, true, e.code);
      return;
    }
    if (state === 'countdown' && e.code !== 'Escape') return;
    const keys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
    if (
      e.code !== jump &&
      e.code !== 'Tab' &&
      e.code !== 'KeyG' &&
      e.code !== 'Escape' &&
      !keys.includes(e.code)
    )
      return;
    // Tab cycles targets on the game canvas; focused HUD controls retain normal keyboard traversal.
    if (e.code === 'Tab' && e.target !== canvas) return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      if (state === 'paused') resume();
      else if (hud.aimPad.skill !== null) hud.aimPad.close();
      else if (aiming !== null) {
        aiming = null;
        course.showAim(null);
        hud.update(match, null, slot);
      } else pause();
    } else if (e.code === jump) evade(true, 'key');
    else if (e.code === 'Tab') cycle();
    else if (e.code === 'KeyG') callTarget();
    else if (e.shiftKey) repeatCast(keys.indexOf(e.code) as Skill);
    else cast(keys.indexOf(e.code) as Skill);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === jump) evade(false, 'key');
    if (pressed.has(e.code)) held('', false, e.code);
  });
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  playableViewport.addEventListener('change', () => {
    if (!playableViewport.matches) pause();
  });
  function renderCourse(dt: number, subtick: number, waitingSeconds?: number) {
    course.render(match, dt, subtick, slot, matchOutfits, waitingSeconds);
    hud.drawCombatNumbers(
      match.healthChanges,
      match.tick + subtick,
      slot,
      course.projectHealthChange,
    );
  }
  function renderFrame() {
    if (state !== 'playing' && state !== 'countdown') return;
    const now = performance.now();
    let elapsed = now - previous;
    previous = now;
    if (state === 'countdown') {
      // The host's first tick can reach a peer before its local countdown expires.
      if (round && match.tick > 0) countdownMs = 0;
      const waiting = Math.min(countdownMs, elapsed);
      countdownMs -= waiting;
      if (countdownMs > 0) {
        audio.count(Math.ceil(countdownMs / 1000));
        hud.showStartCountdown(Math.ceil(countdownMs / 1000));
        renderCourse(Math.min(elapsed / 1000, 0.1), 0, (startDelayMs - countdownMs) / 1000);
        return;
      }
      // Only the part of this frame after the start signal advances the match.
      elapsed -= waiting;
      audio.count(0);
      enterCourse();
      if (!round) move();
    }
    const dt = elapsed / 1000;
    // Catch up the match clock in fixed ticks, even if a foreground frame takes longer to render.
    if (!round) carry += dt * RAID_HZ;
    const wasRespawning = match.runners[slot]!.respawn > 0;
    while (!round && carry >= 1 && !match.result) {
      const wasOut = match.runners[slot]!.respawn > 0;
      solo.step();
      carry--;
      if (wasOut && !match.runners[slot]!.respawn) move();
    }
    if (match.result) {
      finishMatch();
      return;
    }
    const respawning = match.runners[slot]!.respawn > 0;
    if (round) {
      if (onlineRespawning && !respawning) move();
      onlineRespawning = respawning;
    }
    const lostAim = aiming !== null && !canUseRaidSkill(match.runners[slot]!, aiming);
    if (lostAim) {
      aiming = null;
      course.showAim(null);
    }
    // The network owns whole ticks. Sample only the fraction before its next tick.
    const subtick = round
      ? Math.min(1, Math.max(0, ((now - lastFrameAt) * RAID_HZ) / 1000))
      : carry;
    renderCourse(Math.min(dt, 0.1), subtick);
    audio.update(match, slot);
    if (
      Math.floor(match.tick / 3) !== Math.floor(lastHudTick / 3) ||
      wasRespawning !== respawning ||
      lostAim
    ) {
      hud.update(match, aiming, slot);
    } else if (match.tick !== lastHudTick) hud.updateSkills(match.runners[slot]!, aiming);
    lastHudTick = match.tick;
    if (aiming !== null) refreshKeyboardAim();
    else hud.aimPad.refresh();
  }
  return { enter: lobby.open, exit: () => resetLobby(undefined, true) };
}
