/** Install in each game document, including the mobile landscape host. */
export function installGameGestures() {
  const editors = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
  const nativeControls = editors + ', select, [data-copyable]';
  function preventOutsideControls(event: Event) {
    if (event.target instanceof Element && event.target.closest(nativeControls)) return;
    event.preventDefault();
  }
  document.addEventListener('contextmenu', preventOutsideControls);
  document.addEventListener('dragstart', preventOutsideControls);
  document.addEventListener('mousedown', (event) => {
    // Suppress middle-button autoscroll; links still open in a new tab.
    if (event.button === 1 && !(event.target instanceof Element && event.target.closest('a[href]')))
      preventOutsideControls(event);
  });
  function preventNavigationDrop(event: DragEvent) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(editors) &&
      !event.dataTransfer?.types.includes('Files')
    )
      return;
    event.preventDefault();
    if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  }
  document.addEventListener('dragover', preventNavigationDrop);
  document.addEventListener('drop', preventNavigationDrop);

  // WebKit exposes trackpad pinch/rotation separately from pointer input.
  for (const type of ['gesturestart', 'gesturechange'])
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  document.addEventListener(
    'wheel',
    (event) => {
      // Trackpad pinches arrive as Ctrl+wheel. The model viewer owns ordinary canvas wheels.
      if (event.ctrlKey || event.target instanceof HTMLCanvasElement) event.preventDefault();
    },
    { passive: false },
  );
}
