// Compatibility entry point for existing UI extensions.
function toggleApp(appId, state) {
  if (state) window.Desktop.launch(appId);
  else window.Desktop.close(appId);
}
