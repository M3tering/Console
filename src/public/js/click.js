let interfaceClick;
function clickButton() {
  if (!window.Desktop?.getPreferences().sounds) return;
  interfaceClick ||= new Audio('/assets/rclick-13693.mp3');
  interfaceClick.currentTime = 0;
  interfaceClick.play().catch(() => {});
}
function deleteMeter(publicKey) {
  clickButton();
  fetch('/delete-meter?publicKey=' + encodeURIComponent(publicKey), { method: 'DELETE' })
    .then(async response => {
      if (!response.ok) throw new Error((await response.json()).message || 'Unable to delete meter');
      window.location.reload();
    }).catch(error => showNotification(error.message, 'error'));
}
