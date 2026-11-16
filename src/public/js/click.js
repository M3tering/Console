let interfaceClick;
function clickButton() {
  if (!window.Desktop?.getPreferences().sounds) return;
  interfaceClick ||= new Audio('/assets/rclick-13693.mp3');
  interfaceClick.currentTime = 0;
  interfaceClick.play().catch(() => {});
}
