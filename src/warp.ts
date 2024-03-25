import { State } from "./types";
import { WarpFactory, Tag } from "warp-contracts";
import { EthersExtension } from "m3tering-ethers";
import { Ed25519Extension } from "m3tering-ed25519";

const warp = WarpFactory.forMainnet()
  .use(new Ed25519Extension())
  .use(new EthersExtension());

export async function interact(contractId: string, data: object) {
  const tags = [
    { name: "App-User", value: "M3ters" } as Tag,
    { name: "App-Label", value: "M3tering Protocol" } as Tag,
  ];

  const contract = warp
    .contract(contractId)
    .connect(await warp.arweave.wallets.generate());

  contract.writeInteraction({ data, function: "meter" }, { tags });

  const result = await contract.dryWrite(
    { data, function: "meter" },
    undefined,
    tags
  );

  const state = result.state as State;
  let nonce = state.nonce;
  nonce += 1;
  return { nonce, is_on: state.is_on } as State;
}
