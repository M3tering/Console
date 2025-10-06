import { create } from "express-handlebars";
import express, { Express } from "express";
import { JsonRpcProvider, Contract } from "ethers";

// HBS CONFIG
const hbs = create({
  defaultLayout: "main",
  extname: "hbs",
  helpers: {
    encodeURIComponent: function (value: string) {
      return encodeURIComponent(value);
    },
  },
});

// EXPRESS APP CONFIG
export const app: Express = express();
app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", "./src/views");
app.use(express.json());
app.use(express.static("./src/public"));
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`[server]: Server is running at port ${port}`);
});

// ETHERS JS CONTRACT CONFIG
const provider = new JsonRpcProvider(process.env.MAINNET_RPC);

export const m3ter = new Contract(
  process.env.M3TER_CONTRACT_ADDRESS || "0x40a36C0eF29A49D1B1c1fA45fab63762f8FC423F",
  [
    "function publicKey(uint256) view returns (bytes32)",
    "function tokenID(bytes32) view returns (uint256)",
  ],
  provider
);

export const rollup = new Contract(
  process.env.ROLLUP_CONTRACT_ADDRESS || "0xf8f2d4315DB5db38f3e5c45D0bCd59959c603d9b",
  ["function nonce(uint256 tokenId) external view returns (bytes6)"],
  provider
);
