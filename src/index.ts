import "dotenv/config";
import { db } from "./config/db";
import { create } from "express-handlebars";
import bodyParser from "body-parser";
import { handleUplinks } from "./logic/mqtt";
import express, { Express, Request, Response } from "express";
import path from "path";

const port = process.env.PORT || 3000;
const app: Express = express();

app.use(express.static(path.join(__dirname, "/public")));

const hbs = create({
  defaultLayout: "main",
  extname: "hbs",
  helpers: {
    globalCSS() {
      return "/css/global.css";
    },
    toggleJS() {
      return "/js/toggle.js";
    },
  },
});

app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", "./src/views");

app.use(bodyParser.json());

// handleUplinks();

app.get("/", async (req: Request, res: Response) => {
  let m3ters: object[] = [];
  for await (const [key, value] of db.iterator()) {
    let m3terData = JSON.parse(value);
    m3terData["publicKey"] = key;
    m3ters.push(m3terData);
  }
  res.render("index", { m3ters });
});

app.post("/", async (req: Request, res: Response) => {
  try {
    const { publicKey, tokenId, contractId } = await req.body;
    await db.put(publicKey, JSON.stringify({ tokenId, contractId }));
    res.status(200).send("Item Added");
  } catch (error) {
    console.log(error);
    res.status(400).send(error);
  }
});

app.delete("/:publicKey", async (req: Request, res: Response) => {
  await db.del(req.params.publicKey);
  res.status(200).send("Item Deleted");
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
