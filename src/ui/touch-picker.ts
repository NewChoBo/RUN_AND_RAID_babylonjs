import { uiText } from '../content/locales/ui.ts';
import { setButtonIcon } from './icons.ts';
export type TouchChoice = { value: string; label: string; image?: string; group?: string };

export function choiceCard(choice: TouchChoice, active: boolean, choose: () => void) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'choice-card';
  card.setAttribute('aria-pressed', String(active));
  if (choice.image) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = choice.image;
    card.append(image);
  }
  card.append(choice.label);
  card.onclick = choose;
  return card;
}

export function touchPicker(
  trigger: HTMLButtonElement,
  title: string,
  onPick: (value: string) => void,
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'ui-dialog touch-picker';
  dialog.setAttribute('aria-label', title);
  const header = document.createElement('header');
  header.className = 'ui-dialog-header';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  setButtonIcon(close, 'close', uiText('close'));
  close.onclick = () => dialog.close();
  header.append(heading, close);
  const body = document.createElement('div');
  const groups = document.createElement('nav');
  groups.setAttribute('aria-label', uiText('character'));
  const cards = document.createElement('div');
  cards.className = 'choice-grid';
  body.append(groups, cards);
  dialog.append(header, body);
  document.body.append(dialog);
  trigger.setAttribute('aria-haspopup', 'dialog');
  const portrait = matchMedia('(orientation: portrait)');
  portrait.addEventListener('change', () => {
    if (portrait.matches && dialog.open) dialog.close();
  });
  let choices: TouchChoice[] = [];
  let value = '';
  function setValue(next: string) {
    value = next;
    trigger.textContent = title + ' · ' + (choices.find((c) => c.value === next)?.label ?? '');
  }
  function display(group?: string) {
    for (const b of groups.querySelectorAll('button'))
      b.setAttribute('aria-pressed', String(b.textContent === group));
    cards.replaceChildren(
      ...choices
        .filter((c) => c.group === group)
        .map((c) =>
          choiceCard(c, c.value === value, () => {
            value = c.value;
            trigger.textContent = title + ' · ' + c.label;
            dialog.close();
            onPick(value);
          }),
        ),
    );
    cards.scrollTop = 0;
  }
  trigger.onclick = () => {
    const group = choices.find((c) => c.value === value)?.group;
    const names = [
      ...new Set(choices.map((c) => c.group).filter((g): g is string => g !== undefined)),
    ];
    groups.hidden = !names.length;
    groups.replaceChildren(
      ...names.map((g) => choiceCard({ label: g, value: g }, g === group, () => display(g))),
    );
    display(group);
    dialog.showModal();
    (
      groups.querySelector('[aria-pressed=true]') ?? cards.querySelector('[aria-pressed=true]')
    )?.scrollIntoView({ block: 'nearest' });
  };
  return {
    setValue,
    set(options: TouchChoice[], current: string) {
      choices = options;
      setValue(current);
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
