import { State } from "./types";

export function encode(data: State) {
  console.log(data);
  var nonce = data.nonce;
  var byteArray: number[] = [];

  if (nonce) {
    var byteArray = [0, 0, 0, 0];
    for (var index = 0; index < 4; index++) {
      var byte = nonce & 0xff;
      byteArray[3 - index] = byte;
      nonce = (nonce - byte) / 256;
    }
  }
  if (data.is_on) {
    const status = data.is_on === true ? 1 : 0;
    byteArray.unshift(status);
  }
  return byteArray;
}
