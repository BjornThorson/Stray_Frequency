/** Hover descriptions in landscape use a body-level overlay to escape panel clipping. */
let cleanupHudTooltips: (() => void) | null = null;

export function bindHudTooltips(): void {
  cleanupHudTooltips?.();
  const mount = document.querySelector<HTMLElement>('.compact-hud-tabs');
  const app = document.querySelector<HTMLElement>('#app');
  if (!mount || !app) return;

  const tooltip = document.createElement('div');
  tooltip.id = 'hud-hover-tooltip';
  tooltip.className = 'hud-hover-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);

  const controller = new AbortController();
  const signal = controller.signal;
  const landscape = matchMedia('(orientation:landscape)');
  const selector = '.inventory-tile[data-tooltip],.equipment-slot[data-tooltip],.skill-tile[data-tooltip]';
  let active: HTMLElement | null = null;

  function hide(): void {
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip.hidden = true;
  }

  function position(): void {
    if (!active || !active.isConnected || !landscape.matches ||
        app.classList.contains('layout-editing') || active.closest('[hidden]')) {
      hide();
      return;
    }
    const anchor = active.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const margin = 8;
    let left = anchor.left - box.width - margin;
    if (left < margin) left = anchor.right + margin;
    if (left + box.width > innerWidth - margin) {
      left = anchor.left + (anchor.width - box.width) / 2;
    }
    left = Math.max(margin, Math.min(innerWidth - box.width - margin, left));
    let top = anchor.top - box.height - margin;
    if (top < margin) top = anchor.bottom + margin;
    top = Math.max(margin, Math.min(innerHeight - box.height - margin, top));
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function show(element: HTMLElement | null): void {
    if (!element || !landscape.matches || app.classList.contains('layout-editing')) {
      hide();
      return;
    }
    const description = element.dataset.tooltip;
    if (!description) { hide(); return; }
    if (active !== element) {
      active?.removeAttribute('aria-describedby');
      active = element;
      active.setAttribute('aria-describedby', tooltip.id);
    }
    tooltip.textContent = description;
    tooltip.hidden = false;
    position();
  }

  function find(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
  }

  // Starting a drag should dismiss any lingering hover description.
  mount.addEventListener('pointerdown', hide, { signal });
  mount.addEventListener('pointerover', event => {
    if (event.pointerType !== 'touch') show(find(event.target));
  }, { signal });
  mount.addEventListener('pointerout', event => {
    const source = find(event.target);
    if (!active || source !== active) return;
    if (event.relatedTarget instanceof Node && active.contains(event.relatedTarget)) return;
    hide();
  }, { signal });
  mount.addEventListener('focusin', event => show(find(event.target)), { signal });
  mount.addEventListener('focusout', event => {
    if (find(event.target) === active) hide();
  }, { signal });
  document.addEventListener('scroll', position, { capture: true, signal });
  document.addEventListener('fullscreenchange', position, { signal });
  window.addEventListener('resize', position, { signal });
  landscape.addEventListener('change', position, { signal });
  app.addEventListener('pointerdown', () => {
    if (app.classList.contains('layout-editing')) hide();
  }, { signal });

  cleanupHudTooltips = () => {
    controller.abort();
    hide();
    tooltip.remove();
  };
}
