function toggleApp(appIds) {
  if (clickRef.current) clickRef.current.play();
  var state = isOpen;
  var scroll = document.getElementById("scroll");
  appIds.forEach((appId) => {
    var app = document.getElementById(appId);
    if (!app || !scroll) return console.log(`${appId} not closed`);
    if (state) {
      app.style.display = "none";
      scroll.style.display = "none";
      console.log(`${appId} closed`);
      state = false;
    } else {
      app.style.display = "block";
      scroll.style.display = "block";
      console.log(`${appId} opened`);
      state = true;
    }
  });
  setOpen(state);
}
