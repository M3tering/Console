import { State, Payload } from "../types";
import { WarpFactory, Tag } from "warp-contracts";
import { EthersExtension } from "m3tering-ethers";
import { Ed25519Extension } from "m3tering-ed25519";

const warp = WarpFactory.forMainnet()
  .use(new Ed25519Extension())
  .use(new EthersExtension());

export async function interact(contractId: string, payload: Payload) {
  const input = { payload, function: "meter" };
  const contractLabel = process.env.CONTRACT_LABEL || "M3ters";
  const tags = [
    { name: "Input", value: input.toString() } as Tag,
    { name: "Contract-Label", value: contractLabel } as Tag,
    { name: "Contract-Use", value: "M3tering Protocol" } as Tag,
    { name: "Content-Type", value: "application/json" } as Tag,
  ];

  const contract = warp
    .contract(contractId)
    .connect(await warp.arweave.wallets.generate());

  const result = await contract.dryWrite(
    input,
    undefined,
    tags
  );

  const state = result.state as State;

  const deviceNonce: number = JSON.parse(payload[0])[0];
  const nonce: number = deviceNonce > state.nonce ? deviceNonce + 1 : state.nonce + 1;

  if (result.type === "ok" && "is_on" in state) {
    await contract.writeInteraction(
      input,
      { tags, inputFormatAsData: true }
    );
    return { is_on: state.is_on } as State;
    
  } else if (deviceNonce === 0 && "is_on" in state) {
    return { nonce, is_on: state.is_on } as State;
  } else {
    return { is_on: false } as State;
  }
  return null;
}
