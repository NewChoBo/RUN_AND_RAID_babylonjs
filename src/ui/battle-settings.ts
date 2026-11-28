import { uiText as t } from '../content/locales/ui.ts';
import {
  audioVolume,
  graphicsLevels,
  graphicsQuality,
  setAudioEnabled,
  setAudioVolume,
  setGraphicsQuality,
} from '../platform/browser/battle-settings.ts';
import { button, element } from './elements.ts';
import './styles/battle-settings.css';

/** Both settings windows edit the same preferences. Refresh when a window is opened. */
export function createBattleSettings(parent: HTMLElement, prefix: string) {
  const body = element('div', parent);
  body.className = 'battle-settings';
  const channels = (['voice', 'effects'] as const).map((channel) => {
    const row = element('div', body);
    row.className = 'battle-volume';
    const name = t(channel === 'voice' ? 'voiceVolume' : 'battleSounds');
    const label = element('label', row, name);
    const value = element('span', row);
    value.setAttribute('aria-hidden', 'true');
    const track = element('div', row);
    const muteLabel = element('label', track);
    muteLabel.className = 'battle-speaker';
    const enabled = element('input', muteLabel);
    enabled.type = 'checkbox';
    enabled.id = prefix + '-' + channel;
    enabled.setAttribute('aria-label', name);
    const glyph = element('span', muteLabel);
    glyph.setAttribute('aria-hidden', 'true');
    const slider = element('input', track);
    slider.type = 'range';
    slider.id = enabled.id + '-volume';
    label.htmlFor = slider.id;
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    function refresh() {
      const percent = audioVolume(channel);
      enabled.checked = percent > 0;
      slider.value = String(percent);
      value.textContent = percent + '%';
      slider.setAttribute('aria-valuetext', value.textContent);
    }
    enabled.onchange = () => {
      setAudioEnabled(channel, enabled.checked);
      refresh();
    };
    slider.oninput = () => {
      setAudioVolume(channel, slider.valueAsNumber);
      refresh();
    };
    return refresh;
  });
  const quality = element('div', body);
  quality.className = 'battle-quality';
  const label = element('strong', quality, t('graphics'));
  label.id = prefix + '-graphics-label';
  quality.setAttribute('role', 'group');
  quality.setAttribute('aria-labelledby', label.id);
  function change(delta: number) {
    const index = graphicsLevels.indexOf(graphicsQuality()) + delta;
    if (graphicsLevels[index]) setGraphicsQuality(graphicsLevels[index]);
    refresh();
  }
  const less = button(quality, '◀', () => change(-1));
  less.setAttribute('aria-label', t('lowerGraphics'));
  const level = element('output', quality);
  const more = button(quality, '▶', () => change(1));
  more.setAttribute('aria-label', t('raiseGraphics'));
  function refresh() {
    for (const refreshVolume of channels) refreshVolume();
    const current = graphicsQuality();
    level.textContent = t(
      ({ high: 'qualityHigh', medium: 'qualityMedium', low: 'qualityLow' } as const)[current],
    );
    less.disabled = current === 'low';
    more.disabled = current === 'high';
  }
  refresh();
  return { refresh };
}
