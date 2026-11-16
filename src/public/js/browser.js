(() => {
  const form = document.getElementById('browser-search');
  form.addEventListener('submit', event => {
    const input = document.getElementById('browser-query').value.trim();
    if (!input) { event.preventDefault(); return; }
    const external = document.getElementById('browser-external');
    if (/^https?:\/\//i.test(input)) {
      event.preventDefault();
      try {
        const url = new URL(input);
        if (url.username || url.password) throw new Error();
        document.querySelector('#browser iframe').src = url.href;
        external.href = url.href;
      } catch { showNotification('Enter a valid HTTP or HTTPS address without credentials.', 'error', document.getElementById('browser')); }
      return;
    }
    document.getElementById('browser-query').value = input;
    external.href = `https://www.google.com/search?q=${encodeURIComponent(input)}`;
    // Native GET form submission performs URL encoding and opens Google top-level.
  });
})();
