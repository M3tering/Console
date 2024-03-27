import "dotenv/config";
import { db } from "./src/db";
import { create } from "express-handlebars";
import bodyParser from "body-parser";
import { handleUplinks } from "./src/mqtt";
import express, { Express, Request, Response } from "express";

const port = process.env.PORT || 3000;
const app: Express = express();
const hbs = create({ /* config */ });

app.use(express.static("public"));
app.use(bodyParser.json());
app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set('views', './views');

handleUplinks();

app.get("/", async (req: Request, res: Response) => {
  const m3ters = await db.iterator().all();
  res.render("index", { m3ters });
});

app.post("/", async (req: Request, res: Response) => {
  try {
    const { publicKey, tokenId, contractId } = await req.body;
    await db.put(publicKey, JSON.stringify([tokenId, contractId]));
    res.status(200).send("Item Added");
  } catch (error) {
    console.log(error);
  }
});

app.delete("/", async (req: Request, res: Response) => {
  await db.del(req.body.publicKey);
  res.status(200).send("Item Deleted");
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
