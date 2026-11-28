export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: HTMLElement,
  text = '',
) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  parent.append(node);
  return node;
}

export function button(parent: HTMLElement, text: string, action?: () => void) {
  const node = element('button', parent, text);
  node.type = 'button';
  if (action) node.onclick = action;
  return node;
}
