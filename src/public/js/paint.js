(function () {
  const canvas = document.getElementById('paint-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d'), undo = [], status = document.getElementById('paint-status');
  let pointer = null, last;
  function remember() { undo.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); if (undo.length > 10) undo.shift(); }
  function point(event) { const box = canvas.getBoundingClientRect(); return { x: (event.clientX-box.left)*canvas.width/box.width, y: (event.clientY-box.top)*canvas.height/box.height }; }
  function white() { ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); }
  white();
  canvas.addEventListener('pointerdown', event => {
    if (pointer !== null || event.button !== 0) return;
    event.preventDefault(); remember(); pointer = event.pointerId; canvas.setPointerCapture(pointer); last = point(event);
    ctx.strokeStyle = ctx.fillStyle = document.getElementById('paint-color').value;
    ctx.lineWidth = Number(document.getElementById('paint-size').value); ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(last.x,last.y,ctx.lineWidth/2,0,Math.PI*2); ctx.fill();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const next = point(event); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(next.x,next.y); ctx.stroke(); last = next;
  });
  const end = event => { if (event.pointerId === pointer) { pointer = null; status.textContent = 'Drawing updated. Save PNG to keep a copy.'; } };
  ['pointerup','pointercancel','lostpointercapture'].forEach(name => canvas.addEventListener(name,end));
  document.getElementById('paint-undo').addEventListener('click', () => { const previous = undo.pop(); if(previous) ctx.putImageData(previous,0,0); });
  document.getElementById('paint-clear').addEventListener('click', () => { if (!window.confirm('Clear this drawing? You can undo this change.')) return; remember(); white(); });
  document.getElementById('paint-save').addEventListener('click', () => canvas.toBlob(blob => {
    if (!blob) { status.textContent = 'Could not save the drawing. Please retry.'; return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href=url; link.download='console-paint.png'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }));
})();
