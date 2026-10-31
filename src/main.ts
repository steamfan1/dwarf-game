/**
 * Entry point: find the page's containers and start the app.
 * See src/app/App.ts for how the pieces are wired together.
 */
import './ui/ui.css';
import { App } from './app/App';

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html is missing #${id}`);
  return found;
}

new App({ root: element('app'), game: element('game'), ui: element('ui') }).start();
