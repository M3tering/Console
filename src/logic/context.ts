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
    }
  }
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
const provider = new JsonRpcProvider(process.env.GNOSIS_RPC);
export const m3ter = new Contract(
  "0x39fb420Bd583cCC8Afd1A1eAce2907fe300ABD02",
  ["function keyByToken(uint256) view returns (bytes32)"],
  provider
);
export const protocol = new Contract(
  "0x2b3997D82C836bd33C89e20fBaEF96CA99F1B24A",
  ["function contractByToken(uint256) view returns (string)"],
  provider
);
