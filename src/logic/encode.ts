import { State } from "../types";

export function encode(state: State) {
  let nonce = state.nonce;
  let byteArray: number[] = [];

  if (nonce) {
    byteArray = [0, 0, 0, 0];
    for (let index = 0; index < 4; index++) {
      let byte = nonce & 0xff;
      byteArray[3 - index] = byte;
      nonce = (nonce - byte) / 256;
    }
  }
  byteArray.unshift(state.is_on ? 1 : 0);
  return byteArray;
}
