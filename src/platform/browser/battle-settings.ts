export type AudioChannel = 'effects' | 'voice';
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
function loadChannel(channel: AudioChannel) {
  const key = 'run-and-raid.audio.' + channel;
  const percent = Number(read(key + '.volume') ?? 100);
  return {
    key,
    enabled: read(key) !== 'off',
    volume: Number.isFinite(percent) && percent > 0 && percent <= 100 ? percent : 100,
  };
}
const channels = { effects: loadChannel('effects'), voice: loadChannel('voice') };
export const audioVolume = (channel: AudioChannel) =>
  channels[channel].enabled ? channels[channel].volume : 0;
export function setAudioEnabled(channel: AudioChannel, enabled: boolean) {
  channels[channel].enabled = enabled;
  write(channels[channel].key, enabled ? 'on' : 'off');
}
export function setAudioVolume(channel: AudioChannel, percent: number) {
  if (!Number.isFinite(percent)) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const setting = channels[channel];
  if (value) {
    setting.volume = value;
    write(setting.key + '.volume', String(value));
  }
  setAudioEnabled(channel, value > 0);
}

const graphicsKey = 'run-and-raid.graphics';
const stored = read(graphicsKey);
let quality: GraphicsLevel = graphicsLevels.find((level) => level === stored) ?? 'high';
export const graphicsQuality = () => quality;
export function setGraphicsQuality(level: GraphicsLevel) {
  quality = level;
  write(graphicsKey, level);
}
