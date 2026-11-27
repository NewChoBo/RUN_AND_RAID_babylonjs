import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const templates = resolve('src/ui/templates');

function expandTemplates(html, watchFile) {
  return html.replace(/<!-- ui: ([a-z0-9-]+) -->/g, (_, name) => {
    const file = resolve(templates, name + '.html');
    watchFile?.(file);
    return readFileSync(file, 'utf8').trimEnd();
  });
}

export const lobbyHtml = {
  name: 'lobby-html',
  enforce: 'pre',
  // During builds, register each fragment as a dependency of the HTML entry.
  transform: {
    filter: { id: /[/\\]index\.html$/ },
    handler(html) {
      return expandTemplates(html, (file) => this.addWatchFile(file));
    },
  },
  transformIndexHtml: {
    order: 'pre',
    handler(html, { server }) {
      if (server) return expandTemplates(html);
    },
  },
  handleHotUpdate({ file, server }) {
    if (dirname(resolve(file)) === templates) {
      server.ws.send({ type: 'full-reload', path: '/index.html' });
      return [];
    }
  },
};
