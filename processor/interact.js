const { WarpFactory, Tag } = require("warp-contracts");
const { EthersExtension } = require("m3tering-ethers");
const { Ed25519Extension } = require("m3tering-ed25519");


const warp = WarpFactory.forMainnet()
  .use(new Ed25519Extension())
  .use(new EthersExtension());

export async function interact(contractId, data) {
  const tags = [
    { name: "App-User", value: "M3ters" },
    { name: "App-Label", value: "M3tering Protocol" },
  ];

  const contract = warp
    .contract(contractId)
    .connect(await warp.arweave.wallets.generate());

  const result = await contract.dryWrite(
    { data: JSON.parse(data), function: "meter" },
    undefined,
    tags
  );

  // await contract.writeInteraction(
  //   { data: JSON.parse(data), function: "meter" },
  //   { tags }
  // );

  const state = result.state;
  if (result.type !== "ok") return [state.nonce, 0];
  else return [state.nonce + 1, state.is_on === true ? 1 : 0];
}
