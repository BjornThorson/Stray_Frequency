const HOLD_DELAY_MS = 475;
const DOUBLE_TAP_WINDOW_MS = 450;
const DRAG_DISTANCE_PX = 10;

type ItemAction = () => void;
type MoveInventoryItem = (from: number, to: number) => void;

function showTouchDetail(root: ParentNode, button: HTMLButtonElement): void {
  const detail = root.querySelector<HTMLElement>('#touch-item-detail');
  if (detail && button.dataset.tooltip) detail.textContent = button.dataset.tooltip;
}

/** Preserve desktop clicks and touch gestures while allowing shared inventory drag/drop. */
export function bindItemInteraction(
  root: ParentNode,
  button: HTMLButtonElement,
  action: ItemAction,
  moveInventoryItem: MoveInventoryItem
): void {
  let timer: number | null = null;
  let activePointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let held = false;
  let suppressClick = false;
  let handledTouch = false;
  let lastTouchTapAt = 0;
  const index = Number(button.dataset.inventoryIndex);

  const clearHold = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  const resetPointer = (event: PointerEvent): void => {
    clearHold();
    activePointer = null;
    dragging = false;
    held = false;
    button.classList.remove('inspecting', 'touch-dragging', 'item-dragging');
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
  };

  button.addEventListener('click', (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (button.dataset.doubleUseItem === 'true' || button.dataset.useItem !== 'true') return;
    if (handledTouch) {
      handledTouch = false;
      return;
    }
    action();
  });

  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    held = false;
    suppressClick = false;
    // Captured pointer events still report their actual coordinates for the drop target.
    if (Number.isInteger(index)) button.setPointerCapture(event.pointerId);
    if (event.pointerType !== 'mouse') {
      timer = window.setTimeout(() => {
        held = true;
        showTouchDetail(root, button);
        button.classList.add('inspecting');
      }, HOLD_DELAY_MS);
    }
  });

  button.addEventListener('pointermove', (event) => {
    if (activePointer !== event.pointerId) return;
    if (!dragging && Math.hypot(event.clientX - startX, event.clientY - startY) > DRAG_DISTANCE_PX) {
      clearHold();
      dragging = true;
      button.classList.add('item-dragging');
      if (event.pointerType !== 'mouse') button.classList.add('touch-dragging');
    }
  });

  button.addEventListener('pointerup', (event) => {
    if (activePointer !== event.pointerId) return;
    const wasDragging = dragging;
    const wasHeld = held;
    const drop = wasDragging && Number.isInteger(index)
      ? document.elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLButtonElement>('[data-inventory-index]')
      : null;
    const targetIndex = drop ? Number(drop.dataset.inventoryIndex) : Number.NaN;
    resetPointer(event);
    if (wasDragging) {
      suppressClick = true;
      if (Number.isInteger(index) && Number.isInteger(targetIndex) && targetIndex !== index) {
        moveInventoryItem(index, targetIndex);
      }
      return;
    }
    if (event.pointerType === 'mouse') return;
    if (wasHeld) {
      suppressClick = true; // Do not activate a held item via the synthetic click.
      return;
    }
    if (button.dataset.doubleUseItem === 'true') {
      const now = Date.now();
      handledTouch = true;
      window.setTimeout(() => { handledTouch = false; }, 0);
      if (now - lastTouchTapAt <= DOUBLE_TAP_WINDOW_MS) {
        lastTouchTapAt = 0;
        action();
      } else {
        lastTouchTapAt = now;
      }
      return;
    }
    if (button.dataset.useItem === 'true') {
      handledTouch = true;
      window.setTimeout(() => { handledTouch = false; }, 0);
    }
    action();
  });

  button.addEventListener('pointercancel', (event) => {
    if (activePointer !== event.pointerId) return;
    suppressClick = true;
    resetPointer(event);
  });

  button.addEventListener('dragstart', event => event.preventDefault());
  button.addEventListener('dblclick', (event) => {
    if (suppressClick) return;
    event.preventDefault();
    if (button.dataset.doubleUseItem === 'true' || button.dataset.useItem !== 'true') action();
  });
}
