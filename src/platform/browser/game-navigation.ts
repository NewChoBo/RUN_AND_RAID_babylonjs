// The outer document owns fullscreen. The mobile SPA keeps one landscape viewport
// so canvas input, modal dialogs and layout all use the same coordinate system.
type LandscapeFrame = HTMLIFrameElement & {
  requestGameLandscape(): Promise<boolean>;
  gameReady(): void;
};

export function landscapeFrame(): LandscapeFrame | null {
  const frame = window.frameElement;
  return frame && 'requestGameLandscape' in frame ? (frame as LandscapeFrame) : null;
}

export function mountLandscapeFrame(
  request: LandscapeFrame['requestGameLandscape'],
  splash: HTMLElement,
) {
  const host = document.createElement('div');
  host.className = 'landscape-host';
  const frame = document.createElement('iframe') as LandscapeFrame;
  frame.name = 'run-and-raid';
  frame.className = 'landscape-game';
  frame.title = document.title;
  frame.requestGameLandscape = request;
  frame.gameReady = () => {
    splash.remove();
    frame.inert = false;
  };
  frame.inert = true;
  frame.allowFullscreen = true;
  frame.src = location.href;
  host.append(frame, splash);
  document.body.replaceChildren(host);
  window.addEventListener('hashchange', () => {
    const child = frame.contentWindow;
    if (child && child.location.hash !== location.hash) child.location.replace(location.href);
  });
  // Existing diagnostics in the tab console should follow the active game after navigation.
  for (const name of [
    '__ROOM_DEMO__',
    '__EXPEDITION__',
    '__FRAME_PROFILE__',
    '__LEVEL_DIAGNOSTICS__',
  ]) {
    Object.defineProperty(window, name, {
      get: () => frame.contentWindow && Reflect.get(frame.contentWindow, name),
    });
  }
}

export function syncGameUrl() {
  // Frame navigations already participate in the tab's back/forward history.
  // Mirror the active URL for sharing and reload without inserting a second entry.
  const frame = landscapeFrame();
  if (!frame) return;
  frame.title = document.title;
  window.parent.document.title = document.title;
  window.parent.document.documentElement.lang = document.documentElement.lang;
  if (window.parent.location.href !== location.href)
    window.parent.history.replaceState(window.parent.history.state, '', location.href);
}

export function replaceGameUrl(url: URL) {
  history.replaceState(history.state, '', url);
  syncGameUrl();
}
