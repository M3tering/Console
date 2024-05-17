import { Level } from "level";
import { create } from "express-handlebars";
import express, { Express } from "express";
import { JsonRpcProvider, Contract } from "ethers";

// HBS CONFIG
const hbs = create({
  defaultLayout: "main",
  extname: "hbs",
});

// EXPRESS APP CONFIG
export const app: Express = express();
app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", "./src/views");
app.use(express.json());
app.use(express.static("./src/public"));
app.use(express.urlencoded({ extended: true }));

// ETHERS JS CONTRACT CONFIG
const provider = new JsonRpcProvider(process.env.GNOSIS_RPC);
export const m3ter = new Contract(
  "0x39fb420Bd583cCC8Afd1A1eAce2907fe300ABD02",
  ["function token_to_key(uint256) view returns (bytes32)"],
  provider
);
export const protocol = new Contract(
  "0x2b3997D82C836bd33C89e20fBaEF96CA99F1B24A",
  ["function token_to_contract(uint256) view returns (string)"],
  provider
);

// LEVEL DB CONFIG
export const db = new Level("db", { valueEncoding: "json" });
