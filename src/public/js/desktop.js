/* One application registry and window environment, independent of visual theme. */
(function () {
  'use strict';
  const P = DesktopPreferences;
  const L = DesktopLayout;
  let preferences = P.load();
  const $ = id => document.getElementById(id);
  const all = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const mobile = window.matchMedia('(max-width: 700px)');
  const paths = {
    radio: '<circle cx="12" cy="12" r="2"/><path d="m12 14-4 8h8l-4-8M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
    meter: '<path d="M13 2 5 14h6l-1 8 9-13h-6z"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    paint: '<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 .8-2.8H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="6" r="1"/><circle cx="17" cy="10" r="1"/><circle cx="6" cy="13" r="1"/>',
    settings: '<path d="m10 3-1 3-3-1-2 3 2 2-2 2 2 4 3-1 1 4h4l1-4 3 1 2-4-2-2 2-2-2-3-3 1-1-3z"/><circle cx="12" cy="11" r="3"/>',
    appearance: '<path d="M4 4h16v12H4zM8 20h8m-4-4v4"/><path d="m8 10 2 2 5-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    sliders: '<path d="M5 3v4m0 4v10M12 3v10m0 4v4M19 3v2m0 4v12"/><circle cx="5" cy="9" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="19" cy="7" r="2"/>',
    desktop: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8m-4-4v4"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    minimize: '<path d="M5 16h14"/>',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  };
  function svg(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.grid}</svg>`; }
  all('[data-icon]').forEach(el => { el.innerHTML = svg(el.dataset.icon); });
  const registry = new Map();
  all('.desktop-icon').forEach(el => {
    const id = el.dataset.appId;
    if (registry.has(id)) return;
    registry.set(id, { id, label: el.dataset.appLabel, description: el.dataset.appDescription,
      windowId: el.dataset.windowId || id, icon: el.dataset.iconName || 'grid', element: el });
    el.setAttribute('aria-label', `Open ${el.dataset.appLabel}`);
    el.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
  });
  const windows = new Map();
  let activeWindow = null;
  let z = 5;
  let grid;
  let positions = Object.create(null);
  let layoutFrame = 0;
  let storageWarning = false;
  const announce = message => { $('desktop-announcement').textContent = message; };
  function persist() {
    if (!P.save(preferences) && !storageWarning) {
      storageWarning = true;
      showNotification('Browser storage is unavailable. Preferences will last for this visit only.', 'error', null);
    }
  }
  function updatePreferences(patch) {
    preferences = P.normalize({ ...preferences, ...patch });
    P.apply(preferences);
    windows.forEach(applyAppMode);
    persist();
    syncSettings();
    scheduleLayout();
    updateClock();
    fitWindows();
  }
  function updateClock() {
    const now = new Date();
    $('desktop-clock').dateTime = now.toISOString();
    $('desktop-clock').textContent = new Intl.DateTimeFormat(undefined, {
      ...(mobile.matches ? {} : { weekday: 'short' }), hour: '2-digit', minute: '2-digit', hour12: !preferences.clock24,
    }).format(now);
    $('desktop-clock').title = now.toLocaleDateString(undefined, { dateStyle: 'full' });
  }
  function layout() {
    const area = $('desktop-scroll');
    const width = Math.max(1, area.clientWidth - 4);
    grid = L.dimensions(width, area.clientHeight, preferences.iconSize, registry.size);
    positions = L.arrange([...registry.keys()], grid, preferences.mode === 'manual' ? preferences.positions : {},
      mobile.matches ? 'row' : P.themes[preferences.theme].flow);
    $('desktop-icons').style.height = `${grid.height}px`;
    const margin = mobile.matches ? Math.max(0, (width - grid.cols * grid.cellWidth) / 2) : 0;
    $('desktop-icons').style.marginLeft = `${margin}px`;
    registry.forEach(app => {
      const p = positions[app.id];
      if (!p) return;
      app.element.style.width = `${grid.cellWidth - 4}px`;
      app.element.style.height = `${grid.cellHeight - 4}px`;
      app.element.style.transform = `translate(${p.col * grid.cellWidth}px, ${p.row * grid.cellHeight}px)`;
    });
  }
  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layout);
  }
  function setMode(mode) {
    const patch = { mode };
    if (mode === 'manual' && !Object.keys(preferences.positions).length) patch.positions = positions;
    updatePreferences(patch);
    announce(mode === 'manual' ? 'Manual arrangement enabled. Hold and drag icons, or use Alt and arrow keys.' : 'Automatic arrangement enabled.');
  }
  function commitMove(id, destination) {
    const next = L.move(positions, id, destination, grid);
    // Save by stable application ID only on drop or keyboard movement, not during pointer motion.
    updatePreferences({ positions: next });
    // Commit both icons in an occupied-cell swap in this event, not a later frame.
    cancelAnimationFrame(layoutFrame);
    layout();
    const p = next[id];
    announce(`${registry.get(id).label} moved to column ${p.col + 1}, row ${p.row + 1}.`);
  }
  function resetLayout() {
    if (Object.keys(preferences.positions).length) {
      // Native dialogs retain returnValue between openings, including Escape.
      $('reset-dialog').returnValue = 'cancel';
      if ($('settings').hidden || !$('settings').classList.contains('is-active')) launch('settings');
      AppFeedback.showDialog($('reset-dialog'), $('settings'));
    }
    else updatePreferences({ mode: 'auto', positions: {} });
  }
  $('reset-dialog').addEventListener('close', () => {
    if ($('reset-dialog').returnValue === 'reset') {
      updatePreferences({ mode: 'auto', positions: {} });
      announce('Desktop layout reset.');
    }
  });
  // Pointer gestures support mouse, pen, and a deliberate touch hold. Before the
  // hold, vertical motion scrolls the desktop instead of moving an application.
  registry.forEach(app => {
    const el = app.element;
    let suppressClickUntil = 0;
    el.addEventListener('click', () => {
      if (performance.now() < suppressClickUntil) return;
      all('.desktop-icon.selected').forEach(other => other.classList.remove('selected'));
      el.classList.add('selected');
      launch(app.id);
    });
    el.addEventListener('keydown', event => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dir = directions[event.key];
      if (!dir) return;
      event.preventDefault();
      const p = positions[app.id];
      if (event.altKey && preferences.mode === 'manual') commitMove(app.id, { col: p.col + dir[0], row: p.row + dir[1] });
      else {
        const candidates = [...registry.values()].filter(other => {
          const q = positions[other.id];
          return dir[0] ? q.row === p.row && Math.sign(q.col - p.col) === dir[0] : q.col === p.col && Math.sign(q.row - p.row) === dir[1];
        }).sort((a, b) => Math.abs(positions[a.id].col - p.col) + Math.abs(positions[a.id].row - p.row) - Math.abs(positions[b.id].col - p.col) - Math.abs(positions[b.id].row - p.row));
        candidates[0]?.element.focus();
      }
    });
    el.addEventListener('pointerdown', event => {
      if (preferences.mode !== 'manual' || event.button !== 0 || !event.isPrimary) return;
      const start = { x: event.clientX, y: event.clientY, scroll: $('desktop-scroll').scrollTop };
      const source = { ...positions[app.id] };
      const touch = event.pointerType === 'touch';
      let dragging = false;
      let scrolling = false;
      let destination = source;
      const abort = new AbortController();
      const options = { signal: abort.signal };
      el.setPointerCapture(event.pointerId);
      function begin() {
        if (scrolling) return;
        dragging = true;
        el.classList.add('dragging');
        $('drop-target').hidden = false;
        $('drop-target').style.width = `${grid.cellWidth - 4}px`;
        $('drop-target').style.height = `${grid.cellHeight - 4}px`;
        $('drop-target').style.transform = `translate(${source.col * grid.cellWidth}px,${source.row * grid.cellHeight}px)`;
        announce(`Moving ${app.label}. Release to place, or press Escape to cancel.`);
      }
      const timer = touch ? setTimeout(begin, 350) : null;
      function move(event) {
        if (event.pointerId !== startPointer) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) > 7) {
          if (touch) { scrolling = true; clearTimeout(timer); }
          else begin();
        }
        if (scrolling) { $('desktop-scroll').scrollTop = start.scroll - dy; return; }
        if (!dragging) return;
        const bounds = $('desktop-scroll').getBoundingClientRect();
        if (event.clientY > bounds.bottom - 30) $('desktop-scroll').scrollTop += 12;
        if (event.clientY < bounds.top + 30) $('desktop-scroll').scrollTop -= 12;
        const y = source.row * grid.cellHeight + dy + $('desktop-scroll').scrollTop - start.scroll;
        const x = source.col * grid.cellWidth + dx;
        destination = { col: L.clamp(Math.round(x / grid.cellWidth), 0, grid.cols - 1), row: L.clamp(Math.round(y / grid.cellHeight), 0, grid.rows - 1) };
        el.style.transform = `translate(${L.clamp(x, 0, (grid.cols - 1) * grid.cellWidth)}px,${L.clamp(y, 0, (grid.rows - 1) * grid.cellHeight)}px)`;
        $('drop-target').style.transform = `translate(${destination.col * grid.cellWidth}px,${destination.row * grid.cellHeight}px)`;
      }
      const startPointer = event.pointerId;
      function finish(cancelled) {
        clearTimeout(timer);
        abort.abort();
        el.classList.remove('dragging');
        $('drop-target').hidden = true;
        if (el.hasPointerCapture(startPointer)) el.releasePointerCapture(startPointer);
        if (dragging || scrolling) suppressClickUntil = performance.now() + 500;
        if (dragging && !cancelled) commitMove(app.id, destination);
        else scheduleLayout();
      }
      el.addEventListener('pointermove', move, options);
      el.addEventListener('pointerup', () => finish(false), options);
      el.addEventListener('pointercancel', () => finish(true), options);
      el.addEventListener('lostpointercapture', () => finish(true), options);
      window.addEventListener('blur', () => finish(true), options);
      window.addEventListener('resize', () => finish(true), options);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') finish(true); }, options);
    });
  });

  function clearSelection(event) {
    if (!event.target.closest?.('.desktop-icon')) all('.desktop-icon.selected').forEach(icon => icon.classList.remove('selected'));
  }
  document.addEventListener('pointerdown', clearSelection);
  document.addEventListener('focusin', clearSelection);

  function applyAppMode(win) {
    const mode = preferences.appColorModes[win.appId] || 'theme';
    win.element.dataset.colorMode = mode;
    const control = win.element.querySelector('.window-color-mode');
    if (control) control.value = mode;
    window.dispatchEvent(new CustomEvent('desktop:app-mode', { detail: { id: win.id, mode } }));
  }
  function windowBounds() { return { width: $('window-layer').clientWidth, height: $('window-layer').clientHeight }; }
  function fitWindow(win) {
    if (mobile.matches) return;
    const area = windowBounds();
    const r = win.rect;
    const width = Math.min(r.width, Math.max(1, area.width - 16));
    const height = Math.min(r.height, Math.max(1, area.height - 16));
    const x = L.clamp(r.x, 8, Math.max(8, area.width - width - 8));
    const y = L.clamp(r.y, 8, Math.max(8, area.height - height - 8));
    Object.assign(win.element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  }
  function fitWindows() { windows.forEach(fitWindow); }
  function syncDock() {
    registry.forEach(app => {
      const win = windows.get(app.windowId);
      app.dock.classList.toggle('open', !!win?.open);
      app.dock.classList.toggle('active', activeWindow === app.windowId && win?.appId === app.id && !win?.minimized);
      app.dock.setAttribute('aria-label', `${app.label}${win?.open ? ' (open)' : ''}`);
    });
  }
  function activate(win, focus = false) {
    windows.forEach(other => other.element.classList.toggle('is-active', other === win));
    activeWindow = win?.id || null;
    if (win) {
      win.element.style.zIndex = ++z;
      if (focus) win.element.querySelector('.window-titlebar').focus({ preventScroll: true });
    }
    $('active-app-name').textContent = win ? win.element.dataset.windowTitle : 'Desktop';
    document.title = win ? `${win.element.dataset.windowTitle} · M3tering Console` : 'M3tering Console · Desktop';
    syncDock();
  }
  function nextWindow() {
    const remaining = [...windows.values()].filter(win => win.open && !win.minimized).sort((a, b) => Number(b.element.style.zIndex) - Number(a.element.style.zIndex));
    activate(remaining[0] || null, !!remaining.length);
  }
  function minimize(win) {
    win.minimized = true; win.element.hidden = true; nextWindow();
    if (!activeWindow) registry.get(win.appId)?.dock.focus();
  }
  function close(win) {
    win.open = false; win.minimized = false; win.element.hidden = true;
    if (win.id === 'terminal') cleanupTerminal();
    window.dispatchEvent(new CustomEvent('desktop:close', { detail: { id: win.id } }));
    nextWindow();
    if (!activeWindow) registry.get(win.appId)?.element.focus();
  }
  function maximize(win) {
    win.maximized = !win.maximized;
    win.element.classList.toggle('is-maximized', win.maximized);
    win.element.querySelector('.window-maximize').setAttribute('aria-label', win.maximized ? 'Restore window' : 'Maximize window');
    fitWindow(win);
  }
  all('.app-window').forEach((element, index) => {
    const app = [...registry.values()].find(app => app.windowId === element.id);
    const win = { id: element.id, appId: app?.id, element, open: false, minimized: false, maximized: false,
      rect: { x: 110 + index * 18, y: 28 + index * 10, width: Number(element.dataset.windowWidth) || (element.id === 'settings' ? 900 : 820), height: Number(element.dataset.windowHeight) || 620 } };
    windows.set(win.id, win);
    const header = document.createElement('header');
    header.className = 'window-titlebar';
    header.tabIndex = -1;
    const title = document.createElement('span');
    title.className = 'window-title';
    title.innerHTML = svg(app?.icon || 'grid');
    title.append(document.createTextNode(element.dataset.windowTitle));
    header.append(title);
    const controls = document.createElement('div');
    controls.className = 'window-controls';
    [['minimize', 'Minimize window', () => minimize(win)], ['maximize', 'Maximize window', () => maximize(win)], ['close', 'Close window', () => close(win)]].forEach(([action, label, callback]) => {
      const button = document.createElement('button');
      button.className = `window-${action}`;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = svg(action);
      button.addEventListener('click', callback);
      controls.append(button);
    });
    const colorMode = document.createElement('select');
    colorMode.className = 'window-color-mode'; colorMode.setAttribute('aria-label', 'Application color mode');
    colorMode.title = element.querySelector('iframe') ? 'Window appearance. Embedded websites have their own appearance settings.' : 'Choose this application’s appearance';
    [['theme','Theme'],['light','Light'],['dark','Dark']].forEach(([value,label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label; colorMode.append(option);
    });
    colorMode.addEventListener('change', () => {
      const modes = { ...preferences.appColorModes };
      if (colorMode.value === 'theme') delete modes[win.appId]; else modes[win.appId] = colorMode.value;
      updatePreferences({ appColorModes: modes });
    });
    header.append(colorMode, controls);
    applyAppMode(win);
    element.prepend(header);
    const resize = document.createElement('button');
    resize.className = 'window-resize';
    resize.setAttribute('aria-label', 'Resize window with arrow keys');
    resize.title = 'Drag to resize, or focus and use arrow keys';
    element.append(resize);
    element.addEventListener('pointerdown', () => { if (activeWindow !== win.id) activate(win); });
    element.addEventListener('focusin', () => { if (activeWindow !== win.id) activate(win); });
    header.addEventListener('dblclick', event => { if (!event.target.closest('button, select') && !mobile.matches) maximize(win); });
    function gesture(event, resizing) {
      if (mobile.matches || win.maximized || event.button !== 0 || !event.isPrimary || (!resizing && event.target.closest('button, select'))) return;
      event.preventDefault();
      activate(win);
      const rect = element.getBoundingClientRect();
      const area = $('window-layer').getBoundingClientRect();
      const initial = { x: rect.left - area.left, y: rect.top - area.top, width: rect.width, height: rect.height };
      const start = { x: event.clientX, y: event.clientY };
      const abort = new AbortController();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const id = event.pointerId;
      function finish() { abort.abort(); if (target.hasPointerCapture(id)) target.releasePointerCapture(id); }
      target.addEventListener('pointermove', e => {
        const bounds = windowBounds();
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        win.rect = resizing ? { ...initial, width: L.clamp(initial.width + dx, Math.min(360, bounds.width - 16), bounds.width - initial.x - 8), height: L.clamp(initial.height + dy, Math.min(240, bounds.height - 16), bounds.height - initial.y - 8) } :
          { ...initial, x: L.clamp(initial.x + dx, 8, Math.max(8, bounds.width - initial.width - 8)), y: L.clamp(initial.y + dy, 8, Math.max(8, bounds.height - initial.height - 8)) };
        fitWindow(win);
      }, { signal: abort.signal });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => target.addEventListener(type, finish, { signal: abort.signal }));
      window.addEventListener('blur', finish, { signal: abort.signal });
      window.addEventListener('resize', finish, { signal: abort.signal });
    }
    header.addEventListener('pointerdown', e => gesture(e, false));
    resize.addEventListener('pointerdown', e => gesture(e, true));
    resize.addEventListener('keydown', e => {
      if (!e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const bounds = windowBounds();
      win.rect.width = L.clamp(win.rect.width + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0), 360, Math.max(360, bounds.width - 16));
      win.rect.height = L.clamp(win.rect.height + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0), 240, Math.max(240, bounds.height - 16));
      fitWindow(win);
    });
  });
  function launch(id) {
    const app = registry.get(id);
    const win = app && windows.get(app.windowId);
    if (!win) { showNotification('This extension has no application window available.', 'error', null); return; }
    closeLauncher(false);
    $('desktop-context').hidden = true;
    const wasOpen = win.open;
    win.open = true; win.minimized = false; win.appId = id;
    applyAppMode(win);
    win.element.hidden = false;
    fitWindow(win);
    activate(win, true);
    if (!wasOpen && win.id === 'terminal') showTerminalAuth();
    window.dispatchEvent(new CustomEvent('desktop:open', { detail: { id: win.id } }));
    const frame = win.element.querySelector('iframe[data-src]');
    if (frame && !frame.hasAttribute('src')) frame.src = frame.dataset.src;
    clickButton();
  }
  $('chirpstack-reload').addEventListener('click', () => {
    const frame = $('chirpstack-frame');
    frame.src = frame.dataset.src;
  });
  registry.forEach(app => {
    const art = app.element.querySelector('.app-art');
    const dock = document.createElement('button');
    dock.className = 'dock-app';
    dock.dataset.appId = app.id;
    dock.title = app.label;
    dock.append(art.cloneNode(true));
    dock.addEventListener('click', () => {
      const win = windows.get(app.windowId);
      if (win?.open && !win.minimized && activeWindow === win.id && win.appId === app.id) minimize(win);
      else launch(app.id);
    });
    app.dock = dock;
    $('dock-apps').append(dock);
    const item = document.createElement('button');
    item.className = 'launcher-app';
    item.dataset.appId = app.id;
    item.append(art.cloneNode(true));
    const label = document.createElement('span'); label.textContent = app.label; item.append(label);
    item.title = app.description;
    item.addEventListener('click', () => launch(app.id));
    app.launcher = item;
    $('launcher-apps').append(item);
  });
  let launcherOpener;
  function closeLauncher(restoreFocus = true) {
    const wasOpen = !$('app-launcher').hidden;
    $('app-launcher').hidden = true;
    all('[data-launcher-toggle]').forEach(el => el.setAttribute('aria-expanded', 'false'));
    if (wasOpen && restoreFocus) launcherOpener?.focus();
  }
  all('[data-launcher-toggle]').forEach(button => button.addEventListener('click', () => {
    if (!$('app-launcher').hidden) { closeLauncher(); return; }
    launcherOpener = button;
    $('desktop-context').hidden = true;
    $('app-launcher').hidden = false;
    all('[data-launcher-toggle]').forEach(el => el.setAttribute('aria-expanded', 'true'));
    $('app-search').value = '';
    filterLauncher();
    $('app-search').focus();
  }));
  $('close-launcher').addEventListener('click', () => closeLauncher());
  function filterLauncher() {
    const query = $('app-search').value.trim().toLocaleLowerCase();
    let count = 0;
    registry.forEach(app => { app.launcher.hidden = !`${app.label} ${app.description}`.toLocaleLowerCase().includes(query); if (!app.launcher.hidden) count++; });
    $('launcher-empty').hidden = count > 0;
  }
  $('app-search').addEventListener('input', filterLauncher);
  $('app-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') [...registry.values()].find(app => !app.launcher.hidden)?.launcher.click();
    if (e.key === 'ArrowDown') { e.preventDefault(); [...registry.values()].find(app => !app.launcher.hidden)?.launcher.focus(); }
  });
  $('app-launcher').addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const items = all('button:not([hidden]), input', $('app-launcher'));
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  let desktopHidden = [];
  $('show-desktop').addEventListener('click', () => {
    closeLauncher(false);
    const visible = [...windows.values()].filter(win => win.open && !win.minimized);
    if (visible.length) {
      desktopHidden = visible.sort((a, b) => Number(a.element.style.zIndex) - Number(b.element.style.zIndex)).map(win => win.id);
      visible.forEach(win => { win.minimized = true; win.element.hidden = true; });
      activate(null);
      $('show-desktop').setAttribute('aria-label', 'Restore open windows');
    } else {
      desktopHidden.forEach(id => { const win = windows.get(id); if (win.open) { win.minimized = false; win.element.hidden = false; activate(win); } });
      desktopHidden = [];
      $('show-desktop').setAttribute('aria-label', 'Show desktop');
    }
  });

  Object.entries(P.themes).forEach(([id, theme]) => {
    const card = document.createElement('button');
    card.className = 'theme-card'; card.dataset.themeChoice = id;
    card.setAttribute('aria-label', `Apply ${theme.name} theme`);
    card.innerHTML = `<span class="theme-preview preview-${id}" aria-hidden="true"><span class="preview-bar"></span><span class="preview-icons"><i></i><i></i><i></i></span><span class="preview-window"></span><span class="preview-dock"></span></span><span class="theme-card-copy"><span class="theme-card-title">${theme.name}<span class="theme-check">✓</span></span><small>${theme.description}</small></span>`;
    card.addEventListener('click', () => { updatePreferences({ theme: id }); announce(`${theme.name} theme applied.`); });
    $('theme-cards').append(card);
  });
  function syncSettings() {
    all('[data-theme-choice]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.themeChoice === preferences.theme)));
    all('[data-background]').filter(el => el.tagName === 'BUTTON').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.background === preferences.background)));
    all('input[name="arrangement"]').forEach(el => { el.checked = el.value === preferences.mode; });
    $('icon-size').value = preferences.iconSize;
    $('reduce-motion').checked = preferences.reduceMotion;
    $('interface-sounds').checked = preferences.sounds;
    $('clock-24').checked = preferences.clock24;
    $('context-arrange').textContent = preferences.mode === 'auto' ? 'Arrange icons manually' : 'Arrange icons automatically';
  }
  all('[data-open-settings]').forEach(el => el.addEventListener('click', () => launch('settings')));
  all('[data-settings-tab]').forEach(el => el.addEventListener('click', () => {
    all('[data-settings-tab]').forEach(tab => { if (tab === el) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
    all('[data-settings-panel]').forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== el.dataset.settingsTab; });
    document.querySelector('.settings-content').scrollTop = 0;
  }));
  all('button[data-background]').forEach(el => el.addEventListener('click', () => updatePreferences({ background: el.dataset.background })));
  all('input[name="arrangement"]').forEach(el => el.addEventListener('change', () => setMode(el.value)));
  $('icon-size').addEventListener('change', e => updatePreferences({ iconSize: e.target.value }));
  [['reduce-motion', 'reduceMotion'], ['interface-sounds', 'sounds'], ['clock-24', 'clock24']].forEach(([id, key]) => $(id).addEventListener('change', e => updatePreferences({ [key]: e.target.checked })));
  $('reset-layout').addEventListener('click', resetLayout);
  $('context-reset').addEventListener('click', () => { $('desktop-context').hidden = true; resetLayout(); });
  $('context-arrange').addEventListener('click', () => { $('desktop-context').hidden = true; setMode(preferences.mode === 'auto' ? 'manual' : 'auto'); });
  $('desktop').addEventListener('contextmenu', event => {
    if (event.target.closest('.app-window')) return;
    event.preventDefault();
    closeLauncher(false);
    const menu = $('desktop-context'); menu.hidden = false;
    menu.style.left = `${L.clamp(event.clientX, 8, innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${L.clamp(event.clientY, 8, innerHeight - menu.offsetHeight - 8)}px`;
    menu.querySelector('button').focus();
  });
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#app-launcher,[data-launcher-toggle]')) closeLauncher(false);
    if (!e.target.closest('#desktop-context')) $('desktop-context').hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeLauncher(); $('desktop-context').hidden = true; }
  });
  const observer = new ResizeObserver(() => { scheduleLayout(); fitWindows(); });
  observer.observe($('desktop-scroll'));
  mobile.addEventListener('change', () => { scheduleLayout(); fitWindows(); updateClock(); });
  window.addEventListener('storage', e => {
    if (e.key !== P.KEY) return;
    preferences = P.load(); P.apply(preferences); syncSettings(); scheduleLayout(); fitWindows(); updateClock();
  });
  P.apply(preferences);
  syncSettings(); layout(); fitWindows(); syncDock(); updateClock();
  const clockTimer = setInterval(updateClock, 1000 * 15);
  window.addEventListener('pagehide', e => { if (!e.persisted) { observer.disconnect(); clearInterval(clockTimer); } });
  window.Desktop = Object.freeze({
    launch,
    close: id => { const win = windows.get(registry.get(id)?.windowId || id); if (win) close(win); },
    getPreferences: () => P.normalize(preferences),
  });
})();
