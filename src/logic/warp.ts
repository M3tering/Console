import { State, Payload } from "../types";
import { WarpFactory, Tag } from "warp-contracts";
import { EthersExtension } from "m3tering-ethers";
import { Ed25519Extension } from "m3tering-ed25519";

const warp = WarpFactory.forMainnet()
  .use(new Ed25519Extension())
  .use(new EthersExtension());

export async function interact(contractId: string, payload: Payload) {
  const contractLabel = process.env.CONTRACT_LABEL || "M3ters";
  const tags = [
    { name: "Contract-Label", value: contractLabel } as Tag,
    { name: "Contract-Use", value: "M3tering Protocol" } as Tag,
  ];

  const contract = warp
    .contract(contractId)
    .connect(await warp.arweave.wallets.generate());

  const result = await contract.dryWrite(
    { payload, function: "meter" },
    undefined,
    tags
  );

  const state = result.state as State;

  const deviceNonce: number = JSON.parse(payload[0])[0];
  const nonce: number =
    deviceNonce > state.nonce ? deviceNonce + 1 : state.nonce + 1;

  if (result.type === "ok") {
    await contract.writeInteraction({ payload, function: "meter" }, { tags });
    return { is_on: state.is_on } as State;
  } else if (deviceNonce === 0) {
    return { nonce, is_on: true } as State;
  }
  return null;
}
