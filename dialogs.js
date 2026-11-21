(() => {
  const root = document.documentElement;
  const body = document.body;
  const opened = new Map();
  let saved = null;
  let lastTouchY = 0;
  const viewport = window.visualViewport;
  function syncViewport() {
    // In an iframe innerHeight is the frame's assigned height. Only the top
    // level has a distinct visual viewport; the Toolbox owns sizing there.
    const useVisual = window === window.top && viewport && viewport.scale === 1;
    root.style.setProperty('--sl-viewport-height', `${useVisual ? viewport.height : window.innerHeight}px`);
    root.style.setProperty('--sl-viewport-top', `${useVisual ? viewport.offsetTop : 0}px`);
  }
  syncViewport();
  window.addEventListener('resize', syncViewport);
  viewport?.addEventListener('resize', syncViewport);
  viewport?.addEventListener('scroll', syncViewport);

  function lock() {
    saved = { x: window.scrollX, y: window.scrollY, body: body.getAttribute('style'), root: root.getAttribute('style') };
    // overflow:hidden alone does not reliably lock Safari's document scrolling.
    // Preserve the visible page with a negative offset, then restore it exactly.
    root.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `${-saved.y}px`;
    body.style.left = `${-saved.x}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
  }
  function restoreStyle(element, value) {
    if (value === null) element.removeAttribute('style');
    else element.setAttribute('style', value);
  }
  function unlock() {
    if (!saved) return;
    const position = saved;
    saved = null;
    restoreStyle(body, position.body);
    restoreStyle(root, position.root);
    syncViewport();
    window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
  }
  window.SpottersDialogs = {
    show(modal) {
      if (!modal || opened.has(modal)) return;
      const trigger = document.activeElement;
      if (!opened.size) lock();
      opened.set(modal, trigger);
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      const card = modal.querySelector('.modalCard');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      const title = modal.querySelector('.modalTitle');
      if (title) {
        if (!title.id) title.id = `${modal.id}Title`;
        card.setAttribute('aria-labelledby', title.id);
      }
      const content = modal.querySelector('.modalBody, .savedList');
      if (content) {
        content.scrollTop = 0;
        content.setAttribute('tabindex', '0');
        content.setAttribute('role', 'region');
        content.setAttribute('aria-label', 'Scrollable popup content');
      }
      modal.querySelector('.modalHead button')?.focus({ preventScroll: true });
    },
    hide(modal) {
      if (!modal) return;
      const trigger = opened.get(modal);
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      opened.delete(modal);
      if (!opened.size) unlock();
      if (trigger?.isConnected && trigger !== body) trigger.focus({ preventScroll: true });
    },
  };

  // Stop a gesture from chaining to the document at either end, including a
  // short popup with no scroll range. Pinch zoom keeps its normal behaviour.
  document.addEventListener('touchstart', (event) => {
    if (event.touches.length === 1) lastTouchY = event.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    if (!opened.size || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const delta = lastTouchY - y;
    lastTouchY = y;
    let node = event.target instanceof Element ? event.target : event.target.parentElement;
    while (node && node !== body) {
      if (node.matches('.modal.show .modalBody, .modal.show .savedList')) {
        const max = node.scrollHeight - node.clientHeight;
        if (max > 1 && ((delta > 0 && node.scrollTop < max - 1) || (delta < 0 && node.scrollTop > 0))) return;
      }
      node = node.parentElement;
    }
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  document.addEventListener('keydown', (event) => {
    const modal = [...opened.keys()].at(-1);
    if (!modal) return;
    if (event.key === 'Escape') {
      // Use existing close handlers, including first-run airport protection.
      modal.querySelector('.modalHead button')?.click();
    }
    if (event.key !== 'Tab') return;
    const focusable = [...modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
      .filter((element) => !element.disabled && element.getClientRects().length);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }); }
  });
})();
