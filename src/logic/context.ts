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
  "0x7c6FEF064603B91bE9d739fE981c28Fd82a6D62b", // "0x40a36C0eF29A49D1B1c1fA45fab63762f8FC423F",
  ["function publicKey(uint256) view returns (bytes32)"],
  provider
);

export const rollup = new Contract(
  "0x6E31632D6A7Af8d30766AA9E216c49F5AAb846c2", // TODO: Replace with actual rollup contract address
  ["function nonce(uint256 tokenId) external view returns (bytes6)"],
  provider
);
