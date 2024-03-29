function toggleApp(appId, state) {
  var click = new Audio("/assets/rclick-13693.mp3");
  click.play();

  const iconState = state === true ? "none" : "block";
  const appState = state === true ? "block" : "none";

  ["m3ters-icon", "browser-icon", "console-icon", "paint-icon"].forEach(
    (iconId) => {
      var icon = document.getElementById(iconId);
      icon.style.display = iconState;
    }
  );

  var scroll = document.getElementById("scroll");
  var app = document.getElementById(appId);

  scroll.style.display = appState;
  app.style.display = appState;
}
