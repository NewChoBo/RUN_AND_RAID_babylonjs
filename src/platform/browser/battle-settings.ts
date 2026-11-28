export const graphicsLevels = ['low', 'medium', 'high'] as const;
export type GraphicsLevel = (typeof graphicsLevels)[number];

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Still applies for this session. */
  }
}
const effectsKey = 'run-and-raid.audio.effects';
const savedVolume = Number(read(effectsKey + '.volume') ?? 100);
let volume =
  Number.isFinite(savedVolume) && savedVolume > 0 && savedVolume <= 100 ? savedVolume : 100;
let enabled = read(effectsKey) !== 'off';
export const audioVolume = () => (enabled ? volume : 0);
export function setAudioEnabled(value: boolean) {
  enabled = value;
  write(effectsKey, value ? 'on' : 'off');
}
export function setAudioVolume(percent: number) {
  if (!Number.isFinite(percent)) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  if (value) {
    volume = value;
    write(effectsKey + '.volume', String(value));
  }
  setAudioEnabled(value > 0);
}

const graphicsKey = 'run-and-raid.graphics';
const stored = read(graphicsKey);
let quality: GraphicsLevel = graphicsLevels.find((level) => level === stored) ?? 'high';
export const graphicsQuality = () => quality;
export function setGraphicsQuality(level: GraphicsLevel) {
  quality = level;
  write(graphicsKey, level);
}
