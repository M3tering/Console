import "dotenv/config";
import { db } from "./src/db";
import bodyParser from "body-parser";
import { handleUplinks } from "./src/mqtt";
import express, { Express, Request, Response } from "express";

const port = process.env.PORT || 3000;
const app: Express = express();
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

handleUplinks();

app.get("/", async (req: Request, res: Response) => {
  let data: { [key: string]: string } = {};
  for await (const [key, value] of db.iterator()) {
    data[key] = JSON.parse(value);
  }
  res.send(data);
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
