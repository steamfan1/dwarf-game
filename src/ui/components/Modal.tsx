/**
 * A dialog over the game. The backdrop catches every click, so nothing passes through to
 * the world underneath. Escape closes it (see InputActions for the non-field case; here
 * we handle Escape pressed inside a form field, which game input deliberately ignores).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { t } from '../../core/strings';
import { isEditableTarget } from '../../platform/InputActions';
import { Icon } from './Icon';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
  testId?: string;
}

export function Modal({ title, onClose, children, footer, wide = false, testId }: ModalProps) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    // Move focus into the dialog so keyboard users land on its first control.
    const target = panel.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body button, .modal-body input');
    target?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && isEditableTarget(event.target)) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      class="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        class={`panel modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <header class="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" class="btn btn-icon" onClick={onClose} title={t('settings.close')} aria-label={t('settings.close')}>
            <Icon name="close" />
          </button>
        </header>
        <div class="modal-body">{children}</div>
        {footer && <footer class="modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}
