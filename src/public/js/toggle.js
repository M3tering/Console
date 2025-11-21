function toggleApp(appId, state) {
  const iconState = state === true ? "none" : "block";
  const appState = state === true ? "block" : "none";
  var app = document.getElementById(appId);
  app.style.display = appState;

  // Clean up terminal when closing
  if (appId === 'terminal' && state === false && typeof cleanupTerminal === 'function') {
    cleanupTerminal();
  }

  ["m3ters-icon", "browser-icon", "terminal-icon", "paint-icon"].forEach(
    (iconId) => {
      var icon = document.getElementById(iconId);
      icon.style.display = iconState;
    }
  );

}
