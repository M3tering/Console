(function () {
  'use strict';
  const svgNS = 'http://www.w3.org/2000/svg';
  const label = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
  window.M3terCharts = {
    render(container, readings, field) {
      container.replaceChildren();
      const unit = field === 'energy' ? 'kWh' : 'V';
      const rows = readings.filter(row => Number.isFinite(row[field]) && Number.isFinite(row.timestamp));
      if (!rows.length) { container.append(label('p', 'No readings in this range. Waiting for a valid uplink.', 'mm-note')); return; }
      const minTime = rows[0].timestamp, maxTime = rows[rows.length - 1].timestamp;
      const values = rows.map(row => row[field]);
      const bottom = Math.min(...values), top = Math.max(...values), pad = Math.max((top - bottom) * .12, field === 'energy' ? .000001 : 1);
      const low = Math.max(0, bottom - pad), high = top + pad;
      const x = row => maxTime === minTime ? 320 : 8 + (row.timestamp - minTime) / (maxTime - minTime) * 624;
      const y = row => 150 - (row[field] - low) / (high - low) * 140;
      const axes = label('div', '', 'mm-chart-axis'); axes.append(label('span', `${high.toFixed(field === 'energy' ? 6 : 1)} ${unit}`), label('span', `${low.toFixed(field === 'energy' ? 6 : 1)} ${unit}`));
      const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 0 640 160'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('tabindex', '0'); svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${field === 'energy' ? 'Cumulative energy' : 'Voltage'} chart, ${rows.length} points. Use left and right arrows to inspect readings. Energy lines break at observed accumulator decreases.`);
      const grid = document.createElementNS(svgNS, 'path'); grid.setAttribute('d', 'M0 10H640 M0 80H640 M0 150H640'); grid.setAttribute('stroke', 'var(--border)'); grid.setAttribute('stroke-width', '1'); svg.append(grid);
      const line = document.createElementNS(svgNS, 'path');
      line.setAttribute('d', rows.map((row, i) => `${i === 0 || (field === 'energy' && row.segment !== rows[i - 1].segment) ? 'M' : 'L'}${x(row).toFixed(2)} ${y(row).toFixed(2)}`).join(' '));
      line.setAttribute('stroke-width', '2'); line.setAttribute('vector-effect', 'non-scaling-stroke'); line.setAttribute('fill', 'none'); svg.append(line);
      const point = document.createElementNS(svgNS, 'circle'); point.setAttribute('r', '4'); point.setAttribute('fill', 'var(--accent)'); svg.append(point);
      const times = label('div', '', 'mm-chart-axis'); times.append(label('span', new Date(minTime).toLocaleString()), label('span', new Date(maxTime).toLocaleString()));
      const tooltip = label('div', '', 'mm-chart-tooltip'); tooltip.setAttribute('aria-live', 'polite');
      let index = rows.length - 1;
      function inspect(next) {
        index = Math.max(0, Math.min(rows.length - 1, next)); const row = rows[index];
        point.setAttribute('cx', x(row)); point.setAttribute('cy', y(row));
        tooltip.textContent = `${new Date(row.timestamp).toLocaleString()} · ${row[field].toFixed(field === 'energy' ? 6 : 1)} ${unit}`;
      }
      svg.addEventListener('pointermove', event => {
        const bounds = svg.getBoundingClientRect(), target = (event.clientX - bounds.left) / bounds.width * 640;
        let nearest = 0; rows.forEach((row, i) => { if (Math.abs(x(row) - target) < Math.abs(x(rows[nearest]) - target)) nearest = i; }); inspect(nearest);
      });
      svg.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); inspect(event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index + (event.key === 'ArrowLeft' ? -1 : 1)); } });
      inspect(index); container.append(axes, svg, times, tooltip);
    },
  };
})();
