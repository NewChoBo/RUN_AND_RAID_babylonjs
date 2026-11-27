import { devLog } from '../content/dev-log.ts';
import { uiText } from '../content/locales/ui.ts';

const items = document.querySelector<HTMLElement>('#items')!;
const subject = document.querySelector<HTMLElement>('#subject')!;
const date = document.querySelector<HTMLTimeElement>('#post-date')!;
const body = document.querySelector<HTMLElement>('#body')!;
const message = document.querySelector<HTMLDialogElement>('#message')!;
function notify(text: string, lang = document.documentElement.lang) {
  const label = document.querySelector<HTMLElement>('#message-text')!;
  label.lang = lang;
  label.textContent = text;
  message.showModal();
}
for (const entry of devLog) {
  const button = document.createElement('button');
  const tag = document.createElement('span');
  button.lang = 'ko';
  tag.lang = document.documentElement.lang;
  tag.textContent = uiText(entry.tag);
  tag.dataset.kind = entry.tag;
  button.append(tag, entry.title);
  button.setAttribute('aria-pressed', 'false');
  button.onclick = () => {
    items.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
    subject.textContent = entry.title;
    date.dateTime = date.textContent = entry.date;
    body.textContent = entry.body;
    body.parentElement!.scrollTop = 0;
  };
  items.append(button);
}
const first = items.querySelector('button')!;
first.click();
document.querySelector('[data-home]')!.addEventListener('click', () => {
  first.click();
  items.scrollTop = 0;
});
for (const button of document.querySelectorAll('[data-wip]')) {
  button.addEventListener('click', () => notify(uiText('notAvailable')));
}
document
  .querySelector('#details')!
  .addEventListener('click', () =>
    notify(subject.textContent + '\n' + date.dateTime + '\n\n' + body.textContent, 'ko'),
  );
