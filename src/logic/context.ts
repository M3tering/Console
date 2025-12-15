import { create } from "express-handlebars";
import express, { Express } from "express";
import { JsonRpcProvider, Contract } from "ethers";
import WebSocket from "ws";
import { ConnectConfig, Client as SSHClient } from "ssh2";
import http from "http";

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
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", "./src/views");
app.use(express.json());
app.use(express.static("./src/public"));
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;

wss.on("connection", (ws: WebSocket, request: http.IncomingMessage) => {
  console.log("[ws]: New WebSocket connection established");

  console.log("url", request.url);

  const url = new URL(request.url!, "http://localhost");
  const cols = url.searchParams.get("cols") ?? "80";
  const rows = url.searchParams.get("rows") ?? "24";
  const username = url.searchParams.get("username") ?? "ubuntu";
  const password = url.searchParams.get("password") ?? "Mauchly92618";

  const ssh = new SSHClient();
  const sshConfig: ConnectConfig = {
    host: "127.0.0.1",
    port: 22,
    username,
    password,
  };

  ssh
    .on("ready", () => {
      console.log("[ws/ssh]: SSH connection established");
      ssh.shell(
        { term: "xterm", cols: parseInt(cols), rows: parseInt(rows) },
        (err, stream) => {
          if (err) {
            ws.send(`[ws/ssh]: SSH shell error: ${err.message}`);
            ws.close();
            ssh.end();
            return;
          }

          // SSH -> WebSocket
          stream.on("data", (data: Buffer) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          });

          stream.on("close", () => {
            console.log("[ws/ssh]: SSH stream closed");
            ws.close();
            ssh.end();
          });

          stream.stderr.on("data", (data: Buffer) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(`[ws/ssh]: SSH stderr: ${data.toString()}`);
            }
          });

          // WebSocket -> SSH
          console.log("[ws/ssh]: Setting up WebSocket message handler");
          ws.on("message", (msg) => {
            console.log("[ws]: Received message from WebSocket", msg.toString());
            // support JSON control messages for resize
            try {
              const parsed = JSON.parse(msg.toString());
              if (parsed.type === "resize") {
                const { cols, rows } = parsed;
                stream.setWindow(rows, cols, cols * 8, rows * 16); // width/height px optional
                return;
              }
            } catch (e) {
              /* not JSON - treat as raw data */
            }

            if (stream.writable) stream.write(msg);
          });

          ws.on("close", () => {
            console.log("[ws]: WebSocket closed, closing SSH stream");
            stream.end();
            ssh.end();
          });

          ws.on("error", () => {
            console.log("[ws]: WebSocket error, closing SSH stream");
            stream.end();
            ssh.end();
          });
        }
      );
    })
    .on("error", (err) => {
      console.error("[ws/ssh]: SSH connection error:", err);
      ws.send(`[ws/ssh]: SSH connection error: ${err.message}`);
      ws.close();
      ssh.end();
    })
    .connect(sshConfig);
});

server.listen(port, () => {
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
  process.env.CCIP_REVENUE_READER_ADDRESS || "0xD648cdF47e9534B2FCfb18C1E94CA9AAff07BA0E",
  [
    "function read(uint256 tokenId, address target, address verifier) public view returns (uint256)",
    "function readCallback(bytes[] memory data, bytes memory) external pure returns (uint256)",
    "function verifierCount() external view returns (uint256)",
    "function verifiers(uint256) external view returns (string, address)",
  ],
  provider
);

export const priceContext = new Contract(
  process.env.PRICE_CONTEXT_ADDRESS || "0xc6D5Ff8E80F4Ee511Db4bCf6a0BcEbF9f41aAA32",
  ["function owed(uint256 tokenId) public view returns (uint256)"],
  provider
);
