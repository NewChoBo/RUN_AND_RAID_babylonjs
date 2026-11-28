const svgNamespace = 'http://www.w3.org/2000/svg';

export type UiIconName =
  | 'settings'
  | 'close'
  | 'more'
  | 'up'
  | 'down'
  | 'previous'
  | 'next'
  | 'plus'
  | 'minus'
  | 'check'
  | 'chat'
  | 'external'
  | 'back'
  | 'sound'
  | 'muted'
  | 'kill'
  | 'death'
  | 'assist';

/** The surrounding control owns the accessible name, language and touch area. */
export function uiIcon(name: UiIconName) {
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.setAttribute('class', 'ui-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const use = document.createElementNS(svgNamespace, 'use');
  use.setAttribute('href', '#ui-' + name);
  icon.append(use);
  return icon;
}

export function setButtonIcon(button: HTMLButtonElement, name: UiIconName, label: string) {
  button.classList.add('ui-icon-button');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.replaceChildren(uiIcon(name));
}
