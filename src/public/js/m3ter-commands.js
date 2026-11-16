(function () {
  'use strict';
  window.M3terCommands = function ({ api, selected, showError, clearError, notice, element, refresh, text, node }) {
    const $ = element;
    const dialog = $('mm-dialog'), submit = $('mm-submit'), confirm = $('mm-confirm');
    let intent = null, working = false, catalogue = [], historyOffset = 0;
    const uuid = () => crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16));
    function display(title, content, button, sensitive) {
      text('mm-dialog-title', title); $('mm-dialog-content').replaceChildren(...content);
      submit.textContent = button || 'Close'; submit.hidden = !button;
      $('mm-cancel').textContent = button ? 'Cancel' : 'Close';
      $('mm-confirm-label').hidden = !sensitive; confirm.checked = false; submit.disabled = !!sensitive;
      if (!dialog.open) AppFeedback.showDialog(dialog, $('m3ter-manager'));
    }
    confirm.addEventListener('change', () => { submit.disabled = !confirm.checked; });
    $('mm-cancel').addEventListener('click', () => { if (!working) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (working) event.preventDefault(); });
    dialog.addEventListener('close', () => { if (!working) intent = null; });
    async function preview(id, value) {
      const device = selected(); if (!device?.devEui || working) return;
      notice('Preparing command preview…');
      try {
        const command = await api('/commands/preview', { method: 'POST', body: { commandId: id, ...(value === undefined ? {} : { value }) } });
        if (selected()?.devEui !== device.devEui) return;
        intent = { type: 'command', devEui: device.devEui, command, requestId: uuid() };
        const parts = [node('p', `${device.name} · ${device.devEui}`), node('p', command.description),
          node('code', `FPort ${command.fPort} · ${command.length} byte${command.length === 1 ? '' : 's'}\nHex: ${command.hex}\nBase64: ${command.data}`, 'mm-long-code'),
          node('p', 'Unconfirmed downlink. Acceptance into the queue does not verify delivery or execution.', 'mm-note')];
        if (command.confirmation) parts.push(node('p', command.confirmation, 'mm-notice'));
        if (command.parameter) parts.splice(1, 0, node('p', `Selected setting: ${command.parameter}`, 'mm-notice'));
        if (['report-interval','telemetry-interval'].includes(id) && value < 60) parts.push(node('p', 'Short intervals consume more LoRaWAN airtime.', 'mm-notice'));
        display(command.name, parts, 'Enqueue command', command.requiresConfirmation); notice('');
      } catch (error) { showError(error); }
    }
    $('mm-dialog-form').addEventListener('submit', async event => {
      event.preventDefault(); if (!intent || working || (! $('mm-confirm-label').hidden && !confirm.checked)) return;
      const current = intent; working = true; submit.disabled = true; $('mm-cancel').disabled = true;
      try {
        if (current.type === 'clear') {
          notice('Clearing pending downlinks…');
          await api(`/devices/${current.devEui}/queue`, { method: 'DELETE', body: { confirmDevEui: current.devEui } });
          notice('Pending queue cleared. Previously transmitted commands cannot be recalled.');
        } else {
          notice('Enqueuing command…');
          const result = await api(`/devices/${current.devEui}/commands`, { method: 'POST', body: { requestId: current.requestId,
            commandId: current.command.id, value: current.command.value, confirmedSafety: confirm.checked } });
          notice(`${result.command.name}: ${result.status}. ${result.detail || ''}`);
        }
        intent = null; working = false; dialog.close();
        if (selected()?.devEui === current.devEui) await refresh();
      } catch (error) {
        // Retain the request ID after a lost response so retry cannot enqueue twice.
        showError(error); notice(current.type === 'clear' ? 'Queue clearing did not complete. Inspect the queue before retrying: another clear removes ALL items pending at that time.' : 'The request did not complete. Retry uses the same request ID; inspect the queue if the outcome is uncertain.');
        if (current.type === 'clear') confirm.checked = false;
        $('mm-dialog-content').append(node('p', error.message, 'mm-notice mm-error'));
      } finally { working = false; submit.disabled = !$('mm-confirm-label').hidden && !confirm.checked; $('mm-cancel').disabled = false; }
    });
    $('mm-queue-clear').addEventListener('click', () => {
      const device = selected(); if (!device?.devEui || working) return;
      intent = { type: 'clear', devEui: device.devEui };
      display('Clear this meter’s queue?', [node('p', `${device.name} · ${device.devEui}`), node('p', 'This removes ALL currently queued downlinks for this meter, including commands queued outside M3ter Manager. Previously transmitted commands cannot be recalled.')], 'Clear all pending downlinks', true);
    });
    function renderCatalogue(commands) {
      catalogue = commands; const parent = $('mm-commands'); parent.replaceChildren();
      for (const command of catalogue) {
        const card = node('article', '', 'mm-command-card'); card.append(node('span', command.category, 'eyebrow'), node('h4', command.name), node('small', command.description));
        let control;
        if (command.options) {
          control = node('select'); control.setAttribute('aria-label', command.name);
          command.options.forEach(option => { const item = node('option', option.label); item.value = option.value; control.append(item); });
        } else if (command.min !== undefined) {
          const presets = node('select'); presets.setAttribute('aria-label', command.id === 'telemetry-interval' ? 'Telemetry interval presets' : 'Report interval presets');
          [10,15,30,60,300,900,1800,3600].forEach(seconds => { const option = node('option', seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minutes`); option.value = seconds; presets.append(option); });
          const custom = node('option', 'Custom'); custom.value = 'custom'; presets.append(custom); presets.value = '60';
          control = node('input'); control.type = 'number'; control.min = command.min; control.max = command.max; control.step = 1; control.value = command.defaultValue; control.setAttribute('aria-label', command.id === 'telemetry-interval' ? 'Telemetry interval seconds' : 'Report interval seconds');
          presets.addEventListener('change', () => { if (presets.value !== 'custom') control.value = presets.value; });
          control.addEventListener('input', () => { presets.value = 'custom'; }); card.append(presets);
        }
        if (control) card.append(control);
        const button = node('button', 'Preview command', 'nes-btn'); button.dataset.commandId = command.id;
        button.addEventListener('click', () => { if (control && !control.reportValidity()) return; preview(command.id, control ? Number(control.value) : undefined); }); card.append(button); parent.append(card);
      }
    }
    function recordDetails(title, command, detail) {
      const section = node('details', '', 'mm-record'); section.append(node('summary', title), node('p', detail || 'No additional delivery information'),
        node('code', `FPort ${command.fPort} · HEX ${command.hex} · Base64 ${command.data}`, 'mm-long-code'));
      return section;
    }
    async function loadHistory(append = false) {
      const device = selected(); if (!device?.devEui) return;
      if (!append) historyOffset = 0;
      const data = await api(`/devices/${device.devEui}/commands?offset=${historyOffset}`);
      if (selected()?.devEui !== device.devEui) return;
      const parent = $('mm-command-history'); if (!append) parent.replaceChildren();
      if (!data.commands.length && !append) parent.append(node('p', 'No commands have been submitted from M3ter Manager.', 'mm-note'));
      data.commands.forEach(row => parent.append(recordDetails(`${new Date(row.timestamp).toLocaleString()} · ${row.command.name}${row.command.parameter ? ' · ' + row.command.parameter : ''} · ${row.status}`, row.command,
        `${row.detail || 'Awaiting delivery evidence.'} Queue ID: ${row.queueId || 'Unavailable'} · Submitted by ${row.actor}`)));
      historyOffset += data.commands.length; $('mm-commands-more').hidden = data.commands.length < 50;
    }
    async function loadQueue() {
      const device = selected(); if (!device?.devEui) return;
      const parent = $('mm-queue'); parent.replaceChildren(node('p', 'Loading pending queue…', 'mm-note'));
      try {
        const data = await api(`/devices/${device.devEui}/queue`); if (selected()?.devEui !== device.devEui) return;
        parent.replaceChildren();
        if (!data.items.length) parent.append(node('p', 'No pending downlinks.', 'mm-note'));
        if (data.total > data.items.length) parent.append(node('p', `Showing ${data.items.length} of ${data.total} queued items. Clear queue applies to ALL items.`, 'mm-note'));
        data.items.forEach(item => parent.append(recordDetails(`${item.id || 'Queue item'} · ${item.isPending ? 'Pending delivery' : 'Queued'} · ${item.confirmed ? 'Confirmed' : 'Unconfirmed'}`, item,
          `Created: ${item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Unavailable'} · Expires: ${item.expiresAt ? new Date(item.expiresAt).toLocaleString() : 'Unavailable'}`)));
      } catch (error) { if (selected()?.devEui === device.devEui) { parent.replaceChildren(node('p', error.message, 'mm-note')); } throw error; }
    }
    $('mm-queue-refresh').addEventListener('click', () => { clearError(); loadQueue().catch(showError); });
    $('mm-commands-more').addEventListener('click', () => loadHistory(true).catch(showError));
    document.querySelectorAll('[data-mm-command]').forEach(button => button.addEventListener('click', () => preview(button.dataset.mmCommand)));
    return { renderCatalogue, loadHistory, loadQueue,
      inspect(title, details) { intent = null; display(title, [node('code', details, 'mm-long-code')], null, false); },
      close(force = false) { if (force || !working) { dialog.close(); intent = null; } },
    };
  };
})();
