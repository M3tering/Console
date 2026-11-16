(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, text = '', className = '') => { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; };
  const fixed = (n, precision = 2) => typeof n === 'number' && Number.isFinite(n) ? n.toFixed(precision) : '—';
  const date = n => n ? new Date(n).toLocaleString() : 'Unavailable';
  let snapshot = null, rendered = '';
  function list(values) {
    const dl = el('dl', '', 'mm-info');
    for (const [name, value] of values) dl.append(el('dt', name), el('dd', value));
    return dl;
  }
  function metric(name, value, unit) {
    const card = el('article', '', 'mm-metric'), strong = el('strong', value);
    strong.append(el('em', ' ' + unit)); card.append(el('span', name), strong); return card;
  }
  function tick() {
    const state = snapshot?.state, latest = state?.latest;
    const age = latest ? Math.max(0, Math.floor((Date.now() - latest.timestamp) / 1000)) : null;
    const stale = latest && Date.now() - latest.timestamp > snapshot.staleAfter;
    $('mm-telemetry-freshness').textContent = !latest ? 'Telemetry unavailable' : `${stale ? 'Stale' : 'Fresh'} telemetry · ${age < 60 ? age + 's' : age < 3600 ? Math.floor(age / 60) + 'm' : Math.floor(age / 3600) + 'h'} ago`;
    $('mm-telemetry-freshness').dataset.state = latest && !stale ? 'active' : 'inactive';
  }
  function render(next) {
    snapshot = next;
    const fingerprint = JSON.stringify(next);
    if (fingerprint === rendered) { tick(); return; }
    rendered = fingerprint;
    const state = next?.state, sample = state?.latest, t = sample?.telemetry;
    const status = next?.status || 'Unknown · monitoring telemetry has not been observed.';
    $('mm-telemetry-mode').textContent = status;
    $('mm-telemetry-command-status').textContent = status + (next?.intervalRequest ? ` Last requested interval: ${next.intervalRequest.command.value}s (${next.intervalRequest.status}; application unverified).` : '');
    $('mm-telemetry-time').textContent = `FPort 4 measurement: ${date(sample?.timestamp)}`;
    $('mm-telemetry-cadence').textContent = `Stale after ${fixed((next?.staleAfter || 180000) / 1000, 0)} seconds · ${next?.intervalBasis || 'cadence unknown'}. MQTT connectivity is separate from telemetry freshness.`;
    $('mm-electrical-empty').hidden = !!t; $('mm-electrical-data').hidden = !t;
    for (const id of ['mm-electrical-main','mm-electrical-phases','mm-electrical-neutral','mm-electrical-status','mm-electrical-energy','mm-electrical-tracking']) $(id).replaceChildren();
    $('mm-electrical-raw').textContent = '';
    if (!t) { tick(); return; }
    $('mm-electrical-main').append(metric('Total active power',fixed(t.activePower.total,1),'W'), metric('Total reactive power',fixed(t.reactivePower.total,1),'var'),
      metric('Total power factor',fixed(t.powerFactor.total,3),''), metric('Frequency',fixed(t.frequency),'Hz'), metric('Metering chip temperature',fixed(t.temperature,0),'°C'));
    for (const phase of ['a','b','c']) {
      const card = el('article','','mm-command-card'); card.dataset.phase = phase;
      card.append(el('h4',`Phase ${phase.toUpperCase()}`), list([
        ['Voltage',`${fixed(t.voltage[phase])} V`],['Current',`${fixed(t.current[phase])} A`],
        ['Active power',`${fixed(t.activePower[phase],1)} W`],['Reactive power',`${fixed(t.reactivePower[phase],1)} var`],['Power factor',fixed(t.powerFactor[phase],3)],
      ])); $('mm-electrical-phases').append(card);
    }
    $('mm-electrical-neutral').append(metric('Measured neutral current',fixed(t.neutralMeasured),'A'),metric('Calculated neutral current',fixed(t.neutralCalculated),'A'));
    $('mm-electrical-status').append(list([
      ['Uptime',`${Math.floor(t.uptime / 86400)}d ${Math.floor(t.uptime / 3600) % 24}h ${Math.floor(t.uptime / 60) % 60}m ${t.uptime % 60}s`],
      ['Phase mode',t.phaseMode === 'three-phase' ? 'Three-phase' : `Phase ${t.phaseMode.toUpperCase()}`],
      ['Relay',t.relayClosed ? 'Closed (reported)' : 'Open (reported)'],['Relay fitted',t.relayFitted ? 'Yes' : 'No'],
      ['Current PGA',t.currentPga === null ? 'Unknown / reserved flag' : `×${t.currentPga}`],
      ['Voltage PGA',t.voltagePga === null ? 'Unknown / reserved flag' : `×${t.voltagePga}`],['Received by Console',date(sample.receivedAt)],
    ]));
    for (const phase of ['a','b','c','total']) {
      const card = el('article','','mm-command-card');
      card.append(el('h4',phase === 'total' ? 'Total energy' : `Phase ${phase.toUpperCase()} energy`),list([
        ['Forward counter',`${fixed(t.forwardEnergy[phase],5)} kWh`],['Reverse counter',`${fixed(t.reverseEnergy[phase],5)} kWh`],
        ['Forward increase',`${fixed(state.tracking.forward?.[phase],5)} kWh`],['Reverse increase',`${fixed(state.tracking.reverse?.[phase],5)} kWh`],
        ['Observed forward total',`${fixed(state.totals.forward[phase],5)} kWh`],['Observed reverse total',`${fixed(state.totals.reverse[phase],5)} kWh`],
      ])); $('mm-electrical-energy').append(card);
    }
    const explanations = { baseline: 'First frame establishes a baseline; no prior consumption is inferred.', restart: 'Uptime decreased: restart detected. New baselines established; observed totals preserved.',
      'counter-decrease': 'Counter decrease without an uptime reset: affected increases are unknown. High-water baselines are retained to avoid double counting.', tracked: 'Counter increases tracked between valid frames.' };
    $('mm-electrical-tracking').append(el('p',explanations[state.tracking.status] || state.tracking.status),el('p',`Observed totals since ${date(state.startedAt)} exclude unknown energy before the first frame and across resets. They are not billing or guaranteed lifetime totals.`));
    if (state.tracking.estimatedForward !== null) $('mm-electrical-tracking').append(el('p',`Power-based estimate for this interval: ${fixed(state.tracking.estimatedForward,5)} kWh. ${state.tracking.discrepancy ? 'Counter increase differs by more than 50% or 0.01 kWh (whichever is larger). Sparse samples or changing loads can explain this; counters were not altered.' : 'Sanity check only; counters were not altered.'}`));
    $('mm-electrical-raw').textContent = `Measurement UTC: ${new Date(sample.timestamp).toISOString()}\nOriginal payload (${sample.metadata.payloadEncoding || 'unavailable'}): ${sample.rawPayload ?? 'Not supplied; decoded object used'}\nHex: ${sample.metadata.payloadHex || 'Not supplied'}\nMetadata: ${JSON.stringify(sample.metadata,null,2)}\nDecoded telemetry: ${JSON.stringify(t,null,2)}`;
    tick();
  }
  window.M3terElectrical = { render, tick };
})();
