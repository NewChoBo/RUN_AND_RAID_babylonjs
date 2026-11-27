import { uiText } from '../content/locales/ui.ts';
import { raidText } from '../content/locales/run-and-raid.ts';
import { draftMessage, draftMessageLimit } from '../game/raid/raid-draft.ts';

export function createDraftChat(send: (text: string) => void) {
  const dock = document.createElement('section');
  dock.className = 'draft-chat-dock';
  const pane = document.createElement('div');
  pane.className = 'draft-chat';
  const messages = document.createElement('div');
  messages.className = 'draft-messages';
  const heading = document.createElement('strong');
  const log = document.createElement('div');
  log.className = 'draft-chat-log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', uiText('teamChat'));
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.maxLength = draftMessageLimit;
  input.autocomplete = 'off';
  input.placeholder = uiText('chatInput');
  input.setAttribute('aria-label', input.placeholder);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = uiText('chatSend');
  form.append(input, submit);
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = draftMessage(input.value);
    if (!text) return;
    send(text);
    input.value = '';
  };
  input.onkeydown = (e) => {
    if (e.isComposing && e.key === 'Enter') e.preventDefault();
  };
  messages.append(heading, log, form);
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'draft-chat-expand';
  expand.setAttribute('aria-label', uiText('teamChat'));
  expand.setAttribute('aria-haspopup', 'dialog');
  messages.append(expand);
  const quick = document.createElement('div');
  quick.className = 'draft-quick-chat';
  quick.setAttribute('role', 'group');
  quick.setAttribute('aria-label', uiText('quickChat'));
  for (const key of ['chatHello', 'chatGoodLuck', 'chatGoodPick', 'chatSupport'] as const) {
    const button = document.createElement('button');
    const text = uiText(key);
    button.type = 'button';
    button.textContent = text;
    button.onclick = () => send(text);
    quick.append(button);
  }
  pane.append(messages, quick);
  dock.append(pane);

  const dialog = document.createElement('dialog');
  dialog.className = 'draft-chat-dialog';
  dialog.setAttribute('aria-label', uiText('teamChat'));
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = uiText('close');
  close.onclick = () => dialog.close();
  dialog.append(close);
  dialog.onclose = () => {
    if (!dialog.open) dock.append(pane);
  };
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = uiText('teamChat');
  open.setAttribute('aria-haspopup', 'dialog');
  open.onclick = expand.onclick = () => {
    dialog.prepend(pane);
    dialog.showModal();
  };
  function reset() {
    dialog.close();
    dock.append(pane);
    log.replaceChildren();
    input.value = '';
  }
  return {
    dock,
    dialog,
    open,
    reset,
    mode(offline: boolean) {
      heading.textContent = uiText(offline ? 'practiceChat' : 'teamChat');
    },
    append(actor: number, text: string, own: boolean) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 4;
      const line = document.createElement('p');
      const name = document.createElement('b');
      name.textContent = own ? raidText('you') : uiText('chatPlayer', { actor });
      line.append(name, ' · ', text);
      log.append(line);
      if (log.childElementCount > 50) log.firstElementChild?.remove();
      if (own || atBottom) log.scrollTop = log.scrollHeight;
    },
  };
}
