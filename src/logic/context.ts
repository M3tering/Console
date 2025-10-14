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
export const provider = new JsonRpcProvider(process.env.MAINNET_RPC);

export const m3ter = new Contract(
  process.env.M3TER_CONTRACT_ADDRESS || "0x9C547B649475f1bE81323AefdbcF209C17961D5E",
  [
    "function publicKey(uint256) view returns (bytes32)",
    "function tokenID(bytes32) view returns (uint256)",
  ],
  provider
);

export const rollup = new Contract(
  process.env.ROLLUP_CONTRACT_ADDRESS || "0xf8f2d4315DB5db38f3e5c45D0bCd59959c603d9b",
  ["function nonce(uint256) external view returns (bytes6)"],
  provider
);

export const ccipRevenueReader = new Contract(
  process.env.CCIP_REVENUE_READER_ADDRESS || "0x1a1b02d8c67b0fDcf4E379855868DeB470E169cf",
  [
    "function read(uint256 tokenId, address target, address verifier) public view returns (uint256)",
    "function readCallback(bytes[] memory data, bytes memory) external pure returns (uint256)",
    "function verifierCount() external view returns (uint256)",
    "function verifiers(uint256) external view returns (string, address)",
  ],
  provider
);

export const priceContext = new Contract(
  process.env.PRICE_CONTEXT_ADDRESS || "0x0000000000000000000000000000000000000000",
  ["function owed(uint256 tokenId) public view returns (uint256)"],
  provider
);
