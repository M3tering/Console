(function () {
  'use strict';
  const root = document.getElementById('m3ter-manager'); if (!root) return;
  const $ = id => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  const node = (tag, value = '', className = '') => { const result = document.createElement(tag); result.textContent = value; if (className) result.className = className; return result; };
  const date = value => value ? new Date(value).toLocaleString() : 'Unavailable';
  const fixed = (value, places) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(places) : '—';
  let authenticated = false, authVersion = 0;
  let active = false, device = null, latest = null, state = null, config = null, electrical = null, tab = 'overview', monitoring = { state: 'disconnected' };
  let socket, reconnectTimer, clockTimer, refreshTimer, searchTimer, streamTimer, pollTimer;
  let polling = false, pollVersion = 0, snapshotVersion = 0, searchVersion = 0;
  let devices = [], deviceOffset = 0, historyOffset = 0, eventOffset = 0, historyData = null;
  function notice(message) { text('mm-notice', message); $('mm-notice').hidden = !message; }
  function showError(error) { if (!authenticated) return; if (error?.name === 'AbortError') return; text('mm-error', error.message || 'Unable to load meter data. Retry using Refresh.'); $('mm-error').hidden = false; }
  function clearError() { $('mm-error').hidden = true; }
  async function api(path, options = {}) {
    const version = authVersion, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/m3ter-manager' + path, { ...options, signal: controller.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body) });
      let data; try { data = await response.json(); } catch (error) {
        if (controller.signal.aborted) throw error;
        const detail = response.status === 403 ? 'Request rejected by the server. Reload Console at its current address and retry.' : response.status === 404 ? 'The running backend does not have the Manager API. Deploy the matching Console build.' : 'Check the Console backend and proxy connection.';
        throw new Error(`Meter API returned HTTP ${response.status}. ${detail}`);
      }
      if (path !== '/session' && version !== authVersion) throw new DOMException('Session changed', 'AbortError');
      if (response.status === 401 && path !== '/session') lock('Your session ended. Sign in again.');
      if (!response.ok) throw new Error(data.error || 'Meter request failed. Please retry.'); return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Meter request timed out. Check the Console or relay connection and retry.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const commands = M3terCommands({ api, selected: () => device, showError, clearError, notice, element: $, refresh, text, node });
  function range() {
    const selected = $('mm-range').value;
    if (selected !== 'custom') { const to = Date.now(); return { from: to - Number(selected), to }; }
    const from = new Date($('mm-from').value).getTime(), to = new Date($('mm-to').value).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 366 * 86400000) throw new Error('Choose a valid date range of at most 366 days.');
    return { from, to };
  }
  function relative(timestamp) {
    if (!timestamp) return 'Never observed';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
  }
  function renderActivity() {
    M3terElectrical.tick();
    const status = monitoring.state || 'disconnected'; text('mm-mqtt', `MQTT ${status}`); $('mm-mqtt').dataset.state = status;
    text('mm-last-message', `Last MQTT message: ${date(monitoring.lastMessage)}`);
    const last = state?.lastUplink || null, recent = last && Date.now() - last <= (config?.inactiveMilliseconds || 300000);
    text('mm-age', relative(last)); text('mm-uplink-time', date(last));
    text('mm-activity', !last ? 'No uplink observed' : recent ? 'Recent uplink' : 'No recent uplink'); $('mm-activity').dataset.state = recent ? 'active' : 'inactive';
    $('mm-activity').title = `Activity threshold: ${(config?.inactiveMilliseconds || 300000) / 1000} seconds. Connectivity is not verified.`;
  }
  function renderInfo() {
    if (!device) return;
    text('mm-name', device.name || device.devEui); text('mm-eui', device.devEui);
    text('mm-energy', fixed(latest?.energy, 6)); text('mm-voltage', fixed(latest?.voltage, 1)); text('mm-nonce', latest?.nonce ?? '—');
    text('mm-energy-time', latest ? date(latest.timestamp) : 'Awaiting telemetry');
    text('mm-voltage-note', device.phaseMode === 'three-phase' && latest ? `Sum of phases · calculated mean ${fixed(latest.voltage / 3, 1)} V (metadata mode)` : `Transmitted value · ${device.phaseMode || 'phase mode unknown'}`);
    const values = [
      ['Meter', device.name], ['DevEUI', device.devEui], ['Application', device.applicationName || state?.metadata?.applicationName],
      ['Device profile', device.deviceProfileName || state?.metadata?.deviceProfileName], ['LoRaWAN class (ChirpStack)', device.enabledClass],
      ['Device enabled', device.isDisabled === undefined ? null : device.isDisabled ? 'Disabled in ChirpStack' : 'Enabled in ChirpStack'],
      ['Last observed uplink', date(state?.lastUplink)], ['ChirpStack last seen', date(device.lastSeenAt)], ['Energy', latest ? `${fixed(latest.energy,6)} kWh` : null],
      ['Voltage', latest ? `${fixed(latest.voltage,1)} V` : null], ['Nonce', latest?.nonce], ['Accumulation', state?.accumulation?.uncertain ? 'Uncertain reset or gap; awaiting a new cycle' : 'Pending acknowledgement; repeated snapshots are not separate consumption'], ['Pending cycle high-water (kWh)', state?.accumulation ? fixed(state.accumulation.highWater / 1e6,6) : null], ['Phase mode (metadata)', device.phaseMode],
    ];
    $('mm-info').replaceChildren(...values.flatMap(([name, value]) => [node('dt', name), node('dd', value === null || value === undefined || value === '' ? 'Unavailable' : String(value))]));
    const key = state?.publicKey || latest?.publicKey;
    text('mm-public-key', key || 'Unavailable'); $('mm-copy-key').disabled = !key;
    text('mm-verification', latest ? `Latest signed fields: ${latest.verification}. ${latest.verification === 'invalid' ? 'Do not treat this reading as authenticated.' : latest.verification === 'unverified' ? 'No known public key was available to verify this signature.' : 'Nonce and energy were checked with Ed25519.'}` : 'No signature available.');
    const location = state?.metadata?.location; $('mm-location').hidden = !location;
    if (location) {
      const link = node('a', 'View device location on OpenStreetMap ↗'); link.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(location.latitude)}&mlon=${encodeURIComponent(location.longitude)}#map=15/${encodeURIComponent(location.latitude)}/${encodeURIComponent(location.longitude)}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
      $('mm-location').replaceChildren(node('p', `Device location: ${location.latitude}, ${location.longitude} · ChirpStack location event`), link);
    }
    M3terElectrical.render(electrical);
    renderActivity();
  }
  function renderHistory() {
    if (!historyData) return;
    for (const view of ['overview', 'history']) for (const field of ['energy','voltage']) {
      const container = $(`mm-${view}-${field}`);
      M3terCharts.render(container, historyData.chart, field);
      // Keep Analytics unchanged while simplifying the Overview for screen readers too.
      if (view === 'overview') {
        const svg = container.querySelector('svg');
        if (svg) svg.setAttribute('aria-label', `${field === 'energy' ? 'Energy in kWh' : 'Voltage in volts'}. Use left and right arrows to inspect readings.`);
      }
    }
    const summary = historyData.summary;
    text('mm-summary', `${historyData.total} retained reports (${historyData.retentionLimit} globally). Completed-cycle observed lower bounds: ${fixed(summary?.observedConsumption || 0, 6)} kWh. Collector-recorded energy in those completed cycles: ${fixed(summary?.collectedEnergy || 0, 6)} kWh. These are not blockchain settlement totals. Pending snapshots are not added. ${summary?.uncertainReports || 0} uncertain or delayed reports.`);
    const parent = $('mm-readings'); parent.replaceChildren();
    historyData.rows.forEach(row => {
      const tr = node('tr'); [date(row.timestamp), fixed(row.energy,6), fixed(row.voltage,1), row.nonce, row.fPort].forEach(value => tr.append(node('td', String(value))));
      const td = node('td'), button = node('button', 'Inspect', 'nes-btn'); button.addEventListener('click', () => commands.inspect('Uplink details',
        `Meter: ${row.devEui}\nUTC: ${new Date(row.timestamp).toISOString()}\nReceived: ${new Date(row.receivedAt).toISOString()}\nFPort: ${row.fPort}\nNonce: ${row.nonce}\nRaw energy: ${row.rawEnergy}\nAccumulator: ${row.energy} kWh\nCompleted previous cycle lower bound: ${row.intervalEnergy ?? 'Pending / uncertain'} kWh\nCollector-recorded energy for completed cycle: ${row.collectedEnergy ?? 'Unavailable'} kWh\nCompleted nonce: ${row.completedNonce ?? 'None'}\nAccounting: ${row.accounting}\nRaw voltage: ${row.rawVoltage}\nVoltage: ${row.voltage} V\nSignature status: ${row.verification}\nSignature (hex): ${row.signature}\nPublic key: ${row.publicKey || 'Not present in this uplink'}\nRaw payload (${JSON.parse(row.metadata || '{}').payloadEncoding === 'hex' ? 'Hex' : 'Base64'}): ${row.rawPayload}\nRadio metadata: ${row.metadata}`)); td.append(button); tr.append(td); parent.append(tr);
    });
    if (!historyData.rows.length) { const tr = node('tr'), cell = node('td', 'No readings in this range.'); cell.colSpan = 6; tr.append(cell); parent.append(tr); }
    text('mm-history-count', `${historyData.total ? historyOffset + 1 : 0}–${Math.min(historyOffset + historyData.rows.length, historyData.total)} of ${historyData.total}`);
    $('mm-history-prev').disabled = !historyOffset; $('mm-history-next').disabled = historyOffset + 50 >= historyData.total;
  }
  async function loadEvents(append = false) {
    const current = device?.devEui; if (!current) return;
    if (!append) eventOffset = 0;
    const data = await api(`/devices/${current}/events?offset=${eventOffset}`); if (device?.devEui !== current) return;
    const parent = $('mm-events'); if (!append) parent.replaceChildren();
    if (!data.events.length && !append) parent.append(node('li', 'No activity recorded yet.'));
    data.events.forEach(event => {
      const li = node('li'); li.append(node('strong', event.message), node('small', `${date(event.timestamp)} · ${event.source}${event.devEui ? '' : ' · application-wide'}`));
      if (event.rawPayload !== null && event.rawPayload !== undefined) {
        const metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata || {};
        const details = node('details'); details.append(node('summary', 'Inspect payload'));
        if (metadata.payloadHex) details.append(node('small', 'Payload (hex)'), node('code', metadata.payloadHex, 'mm-long-code'));
        details.append(node('small', `Original ${metadata.payloadField || 'data'} (${metadata.payloadEncoding || 'base64'})`), node('code', event.rawPayload, 'mm-long-code'));
        li.append(details);
      }
      parent.append(li);
    });
    eventOffset += data.events.length; $('mm-events-more').hidden = data.events.length < 100;
  }
  async function refresh(telemetryOnly = false, background = false) {
    if (!device) return;
    const current = device.devEui, version = ++snapshotVersion;
    let times; try { times = range(); } catch (error) { showError(error); return; }
    $('mm-selected').setAttribute('aria-busy', 'true');
    const results = await Promise.allSettled([
      telemetryOnly ? Promise.resolve({ device, state, latest }) : api(`/devices/${current}`), api(`/devices/${current}/history?${new URLSearchParams({ ...times, offset: historyOffset })}`),
    ]);
    if (version !== snapshotVersion || device?.devEui !== current || !active) return;
    if (results[0].status === 'fulfilled') { device = { ...device, ...results[0].value.device }; state = results[0].value.state; latest = results[0].value.latest; if (!telemetryOnly) electrical = results[0].value.electrical || null; }
    else if (!background) showError(results[0].reason);
    if (results[1].status === 'fulfilled') { historyData = results[1].value; latest = historyData.latest; state = historyData.state; monitoring = historyData.monitoring; electrical = historyData.electrical || null; renderHistory(); }
    else if (!background) showError(results[1].reason);
    renderInfo(); $('mm-selected').setAttribute('aria-busy', 'false');
    if (tab === 'live') await loadEvents().catch(showError);
    if (tab === 'commands') await commands.loadHistory().catch(showError);
    if (tab === 'queue') await commands.loadQueue().catch(showError);
    return results[1].status === 'fulfilled';
  }
  async function loadDevices(append = false) {
    const version = ++searchVersion, search = $('mm-search').value.trim();
    if (!append) deviceOffset = 0;
    try {
      const data = await api(`/devices?${new URLSearchParams({ search, offset: deviceOffset })}`);
      if (version !== searchVersion || !active) return;
      devices = append ? [...devices, ...data.devices] : data.devices; deviceOffset = data.offset + data.devices.length;
      $('mm-more-devices').hidden = deviceOffset >= data.total; $('mm-device').replaceChildren(node('option', data.total ? 'Choose a meter…' : 'No matching meters'));
      $('mm-device').firstChild.value = '';
      const available = device && !devices.some(item => item.devEui === device.devEui) ? [device, ...devices] : devices;
      available.forEach(item => { const option = node('option', `${item.name} · ${item.devEui}`); option.value = item.devEui; $('mm-device').append(option); });
      $('mm-device').value = device?.devEui || '';
      if (!device) {
        let saved; try { saved = localStorage.getItem('m3tering.manager.selected'); } catch { /* Optional preference. */ }
        if (saved && devices.some(item => item.devEui === saved)) { $('mm-device').value = saved; selectDevice(saved); }
      }
    } catch (error) { if (version === searchVersion) showError(error); }
  }
  function selectDevice(devEui) {
    snapshotVersion++; device = devices.find(item => item.devEui === devEui) || (device?.devEui === devEui ? device : null);
    latest = null; state = null; electrical = null; M3terElectrical.render(null); historyData = null; historyOffset = 0; commands.close();
    $('mm-empty').hidden = !!device; $('mm-selected').hidden = !device; clearError(); notice('');
    for (const view of ['overview','history']) for (const field of ['energy','voltage']) $(`mm-${view}-${field}`).replaceChildren(node('p', 'Loading readings…', 'mm-note'));
    ['mm-readings','mm-events','mm-command-history','mm-queue'].forEach(id => $(id).replaceChildren());
    if (device) { try { localStorage.setItem('m3tering.manager.selected', device.devEui); } catch { /* Optional preference. */ } renderInfo(); refresh().catch(showError); }
  }
  function selectTab(next) {
    tab = next;
    root.querySelectorAll('[data-mm-tab]').forEach(button => { if (button.dataset.mmTab === next) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
    root.querySelectorAll('[data-mm-panel]').forEach(panel => { panel.hidden = panel.dataset.mmPanel !== next; });
    if (next === 'live') loadEvents().catch(showError);
    if (next === 'commands') commands.loadHistory().catch(showError);
    if (next === 'queue') commands.loadQueue().catch(showError);
  }
  function stopPolling() { polling = false; pollVersion++; clearTimeout(pollTimer); }
  function startPolling() {
    if (polling || !active || !authenticated) return;
    polling = true;
    const version = ++pollVersion;
    text('mm-feed', 'Live feed unavailable · checking HTTP updates…');
    $('mm-feed').title = 'The WebSocket could not be maintained. Authenticated HTTP requests keep readings updated without changing the MQTT connection.';
    async function poll() {
      let available = false;
      try {
        if (device) available = await refresh(true, true);
        else {
          const result = await api('/config');
          if (version !== pollVersion || !active) return;
          monitoring = result.monitoring; renderActivity(); available = true;
        }
      } catch { /* Status below reports failure; 401 is handled by the existing login boundary. */ }
      if (version !== pollVersion || !active || !authenticated) return;
      text('mm-feed', available ? 'Updates every 5s (HTTP fallback)' : 'Automatic updates unavailable · retrying');
      // Schedule after completion: a slow relay cannot accumulate overlapping polls.
      pollTimer = setTimeout(poll, 5000);
    }
    void poll();
  }
  function connectStream() {
    if (!active || !authenticated || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    if (!polling) { text('mm-feed', 'Live feed connecting…'); $('mm-feed').title = ''; }
    let currentSocket;
    try { currentSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/m3ter-manager/live`); }
    catch { startPolling(); reconnectTimer = setTimeout(connectStream, 30000); return; }
    socket = currentSocket;
    let receivedUpdate = false;
    function armTimeout(milliseconds) {
      clearTimeout(streamTimer);
      streamTimer = setTimeout(() => {
        if (socket !== currentSocket || !active) return;
        // Detach a stalled transport before retrying; some relays never finish a handshake.
        socket = null; currentSocket.close(); startPolling(); reconnectTimer = setTimeout(connectStream, 30000);
      }, milliseconds);
    }
    armTimeout(10000);
    currentSocket.onopen = () => { if (socket === currentSocket && active) armTimeout(10000); };
    currentSocket.onmessage = event => {
      if (socket !== currentSocket || !active) return;
      let update; try { update = JSON.parse(event.data); } catch { return; }
      if (!['connection','diagnostic','device'].includes(update?.type)) return;
      armTimeout(75000); // The server sends a status heartbeat every 30 seconds.
      if (!receivedUpdate) {
        receivedUpdate = true; stopPolling(); text('mm-feed', 'Live feed connected'); $('mm-feed').title = '';
        if (device) refresh().catch(showError);
      }
      if (update.type === 'connection') { monitoring = update.monitoring; renderActivity(); }
      if (update.type === 'diagnostic') showError(new Error(update.message));
      if (update.type === 'device' && update.devEui === device?.devEui && !refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; if (active) refresh(true).catch(showError); }, 500);
    };
    currentSocket.onerror = () => { if (socket === currentSocket && active) startPolling(); };
    currentSocket.onclose = event => {
      if (socket !== currentSocket) return;
      socket = null; clearTimeout(streamTimer);
      if (!active) return;
      if (event.code === 4001) { lock('Your session ended. Sign in again.'); return; }
      startPolling(); reconnectTimer = setTimeout(connectStream, 30000);
    };
  }
  function lock(message = '') {
    authVersion++; close(); authenticated = false; config = null; device = null; state = null; latest = null; electrical = null; M3terElectrical.render(null); historyData = null; devices = [];
    commands.close(true); $('mm-workspace').hidden = true; $('mm-login').hidden = false;
    $('mm-password').value = ''; $('mm-device').replaceChildren(node('option', 'Choose a meter…'));
    ['mm-readings','mm-events','mm-command-history','mm-queue','mm-info','mm-dialog-content'].forEach(id => $(id).replaceChildren());
    $('mm-selected').hidden = true; $('mm-empty').hidden = false;
    text('mm-login-error', message); $('mm-login-error').hidden = !message;
  }
  async function startSession() {
    authenticated = true; active = true; $('mm-login').hidden = true; $('mm-workspace').hidden = false;
    notice('Loading meters…'); clearError(); const version = authVersion;
    try { config = await api('/config'); if (!active || version !== authVersion) return; monitoring = config.monitoring; commands.renderCatalogue(config.commands);
      if (config.demo) root.querySelector('.mm-brand small').textContent = 'Demo network · simulated meters';
      await loadDevices(); if (!active || version !== authVersion) return;
      notice(config.billingAutomationActive ? 'Existing console billing automation is enabled and may also control these meters. M3ter Manager only observes telemetry; it does not acknowledge energy reports automatically.' : '');
      connectStream(); clockTimer = setInterval(renderActivity, 1000); if (device) await refresh();
    } catch (error) { notice(''); showError(error); }
  }
  async function open() {
    if (active) return; active = true; $('mm-workspace').hidden = true; $('mm-login').hidden = false;
    const version = authVersion;
    try {
      const session = await api('/session'); if (!active || version !== authVersion) return;
      text('mm-login-help', session.configured ? 'Use the manager credentials configured by your console administrator.' : 'Set M3TER_MANAGER_PASSWORD in .env, then restart the console. The username defaults to admin.');
      if (session.authenticated) await startSession();
    } catch (error) { text('mm-login-error', error.message); $('mm-login-error').hidden = false; }
  }
  $('mm-login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('mm-login-submit').disabled = true; $('mm-login-error').hidden = true;
    try {
      await api('/session', { method: 'POST', body: { username: $('mm-username').value, password: $('mm-password').value } });
      $('mm-password').value = ''; if (!root.hidden) await startSession();
    } catch (error) { text('mm-login-error', error.message); $('mm-login-error').hidden = false; }
    finally { $('mm-login-submit').disabled = false; }
  });
  $('mm-logout').addEventListener('click', async () => {
    try { await api('/session', { method: 'DELETE' }); lock(); }
    catch (error) { showError(new Error('Sign-out could not reach the server. Please retry.')); }
  });
  function close() { active = false; snapshotVersion++; searchVersion++; stopPolling(); clearTimeout(streamTimer); clearTimeout(reconnectTimer); clearTimeout(refreshTimer); clearTimeout(searchTimer); clearInterval(clockTimer); refreshTimer = null; const previous = socket; socket = null; previous?.close(); text('mm-feed', 'Live feed closed'); commands.close(); }
  $('mm-device').addEventListener('change', () => selectDevice($('mm-device').value));
  $('mm-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadDevices(), 250); });
  $('mm-more-devices').addEventListener('click', () => loadDevices(true));
  $('mm-refresh').addEventListener('click', async () => { if (!config) { close(); await open(); } else { clearError(); await loadDevices(); await refresh(); } });
  root.querySelectorAll('[data-mm-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.mmTab)));
  root.querySelectorAll('[data-mm-go]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.mmGo)));
  $('mm-range').addEventListener('change', () => { $('mm-dates').hidden = $('mm-range').value !== 'custom'; historyOffset = 0; if ($('mm-range').value !== 'custom') { clearError(); refresh().catch(showError); } });
  $('mm-dates').addEventListener('submit', event => { event.preventDefault(); historyOffset = 0; clearError(); refresh().catch(showError); });
  $('mm-history-prev').addEventListener('click', () => { historyOffset = Math.max(0, historyOffset - 50); refresh().catch(showError); });
  $('mm-history-next').addEventListener('click', () => { historyOffset += 50; refresh().catch(showError); });
  $('mm-events-more').addEventListener('click', () => loadEvents(true).catch(showError));
  $('mm-copy-key').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state?.publicKey || latest?.publicKey); notice('Public key copied.'); } catch { notice('Clipboard unavailable. Select and copy the displayed public key.'); } });
  window.addEventListener('desktop:open', event => { if (event.detail.id === 'm3ter-manager') open(); });
  window.addEventListener('desktop:close', event => { if (event.detail.id === 'm3ter-manager') close(); });
  window.addEventListener('pagehide', close);
})();
