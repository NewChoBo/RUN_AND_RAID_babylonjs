import type { AbstractEngine } from '@babylonjs/core';
import { graphicsQuality } from '../../browser/battle-settings.ts';

/** The chase scene renders directly to the canvas. Keep its aspect and CSS-space picking
 * in sync when the viewport resizes or moves to a display with a different density. */
export function observeRaidResolution(canvas: HTMLCanvasElement, engine: AbstractEngine) {
  let quality = graphicsQuality();
  function resize() {
    const area = canvas.clientWidth * canvas.clientHeight;
    if (!area) return;
    // Cap high-density rendering at 2x and a total of 1080p pixels.
    // Larger desktop viewports retain one render pixel per CSS pixel.
    const density = Math.max(
      1,
      Math.min(window.devicePixelRatio, 2, Math.sqrt((1920 * 1080) / area)),
    );
    const factor = quality === 'high' ? 1 : quality === 'medium' ? 0.8 : 0.6;
    const scale = 1 / (density * factor);
    if (engine.getHardwareScalingLevel() === scale) engine.resize();
    else engine.setHardwareScalingLevel(scale); // Also resizes the drawing buffer.
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  let previousDensity = window.devicePixelRatio;
  resize();
  // A display change can leave the CSS box unchanged, including while the match is paused.
  const frame = engine.onBeginFrameObservable.add(() => {
    if (previousDensity === window.devicePixelRatio && quality === graphicsQuality()) return;
    quality = graphicsQuality();
    previousDensity = window.devicePixelRatio;
    resize();
  });
  engine.onDisposeObservable.addOnce(() => {
    observer.disconnect();
    engine.onBeginFrameObservable.remove(frame);
  });
}
