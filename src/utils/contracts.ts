import { contractsReady, rollup as rollupContract } from '../services/contracts';

export async function meterIdFromPublicKeyContractCall(publicKey: string) {
  await contractsReady();
  return Number(await rollupContract.m3terId(publicKey));
}

export async function meterLatestNonceContractCall(meterId: number) {
  await contractsReady();
  return Number(await rollupContract.nonce(meterId));
}
