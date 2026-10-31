/**
 * Stops the browser from acting on input the game uses:
 *  - no context menu (right-click means "cancel" in game), except in text fields;
 *  - the mouse wheel and trackpad pinch never scroll or zoom the page over the world;
 *    Ctrl+wheel (browser zoom) is blocked everywhere in the game, so it can't resize the UI;
 *  - middle-click doesn't start autoscroll, so middle-drag can pan the camera;
 *  - the mouse's back/forward buttons don't navigate away from the game;
 *  - images and the canvas can't be dragged or text-selected by accident.
 *
 * Keyboard keys are handled in InputActions. Keys the browser reserves (F3, F5,
 * Ctrl+S/W/T...) are never bound, so they keep their normal meaning.
 */
import { isEditableTarget } from './InputActions';

export interface GuardTargets {
  /** The whole game (canvas and UI overlay). */
  app: HTMLElement;
  /** The element that holds the Phaser canvas. */
  world: HTMLElement;
}

/** Install all guards; returns a function that removes them again. */
export function installBrowserGuards({ app, world }: GuardTargets): () => void {
  const removers: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void => {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  };

  listen(app, 'contextmenu', (event) => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  });

  // Non-passive, or preventDefault() is ignored for wheel events.
  listen(world, 'wheel', (event) => event.preventDefault(), { passive: false });
  listen(app, 'wheel', (event) => {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });

  listen(world, 'mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });

  // Buttons 3 and 4 are "back" and "forward" on most mice.
  const blockNavigationButtons = (event: MouseEvent): void => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  };
  listen(app, 'mouseup', blockNavigationButtons);
  listen(app, 'auxclick', blockNavigationButtons);

  listen(world, 'dragstart', (event) => event.preventDefault());
  listen(world, 'selectstart', (event) => event.preventDefault());

  return () => {
    for (const remove of removers) remove();
    removers.length = 0;
  };
}
