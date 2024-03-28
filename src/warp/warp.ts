import { State, Payload } from "../types";
import { WarpFactory, Tag } from "warp-contracts";
import { EthersExtension } from "m3tering-ethers";
import { Ed25519Extension } from "m3tering-ed25519";

const warp = WarpFactory.forMainnet()
  .use(new Ed25519Extension())
  .use(new EthersExtension());

export async function interact(contractId: string, data: Payload) {
  const tags = [
    { name: "App-User", value: "M3ters" } as Tag,
    { name: "App-Label", value: "M3tering Protocol" } as Tag,
  ];

  const contract = warp
    .contract(contractId)
    .connect(await warp.arweave.wallets.generate());

  const result = await contract.dryWrite(
    { data, function: "meter" },
    undefined,
    tags
  );

  const state = result.state as State;

  const deviceNonce: number = data[2][0];
  const nonce: number =
    deviceNonce > state.nonce ? deviceNonce + 1 : state.nonce + 1;

  if (result.type === "ok") {
    await contract.writeInteraction({ data, function: "meter" }, { tags });
    return { is_on: state.is_on } as State;
  } else if (data[2][0] === 0) {
    return { nonce, is_on: true } as State;
  }
  return null;
}
