import { landscapeFrame } from './game-navigation.ts';

// Some mobile browsers expose ScreenOrientation without the optional locking API.
type LockableOrientation = ScreenOrientation & { lock?(direction: 'landscape'): Promise<void> };

let locked: 'window' | 'fullscreen' | null = null;
let pending: Promise<boolean> | null = null;

export function canRequestLandscape() {
  return (
    document.documentElement.hasAttribute('data-mobile') &&
    typeof (screen.orientation as LockableOrientation | undefined)?.lock === 'function'
  );
}

async function acquire() {
  try {
    await (screen.orientation as LockableOrientation).lock!('landscape');
    return true;
  } catch {
    // The game frame still supplies a landscape layout when the browser denies the lock.
    return false;
  }
}

export function requestLandscape(): Promise<boolean> {
  const frame = landscapeFrame();
  if (frame) return frame.requestGameLandscape();
  if (!canRequestLandscape()) return Promise.resolve(false);
  if (document.hidden) return Promise.resolve(false);
  if (locked === 'window' || (locked === 'fullscreen' && document.fullscreenElement))
    return Promise.resolve(true);
  if (pending) return pending;

  const promise = acquire().then((accepted) => {
    if (pending === promise) {
      pending = null;
      if (accepted) {
        locked = document.fullscreenElement ? 'fullscreen' : 'window';
      }
    }
    return accepted;
  });
  pending = promise;
  return promise;
}

export function installLandscapeRecovery() {
  if (!canRequestLandscape()) return;
  const restore = () => {
    locked = null;
    pending = null;
    if (!document.hidden) void requestLandscape();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      locked = null;
      pending = null;
    } else restore();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) restore();
  });
  screen.orientation.addEventListener('change', () => {
    if (screen.orientation.type.startsWith('portrait')) restore();
  });
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) restore();
    else {
      locked = null;
      pending = null;
    }
  });
}
