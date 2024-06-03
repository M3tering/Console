function clickButton() {
  var click = new Audio("/assets/rclick-13693.mp3");
  click.play();
}

function deleteMeter(publicKey) {
  console.log(encodeURIComponent(publicKey));
  clickButton();
  fetch("/delete-meter?publicKey=" + encodeURIComponent(publicKey), {
    method: 'DELETE',
  }).then(_res => {
    window.location.reload()
  }, err => console.log(err));
}
