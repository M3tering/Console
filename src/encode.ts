import { State } from "./types";

export function prepData(data: State) {
  console.log(data);
  var nonce = data.nonce;
  var byteArray = [0, 0, 0, 0];

  for (var index = 0; index < byteArray.length; index++) {
    var byte = nonce & 0xff;
    byteArray[3 - index] = byte;
    nonce = (nonce - byte) / 256;
  }

  const status = data.is_on === true ? 1 : 0;
  byteArray.unshift(status);
  return byteArray;
}
