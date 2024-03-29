import "dotenv/config";
import { encodeBase64 } from "ethers";
import { handleUplinks } from "./logic/mqtt";
import { Request, Response } from "express";
import { app, db, m3ter, protocol } from "./config/context";

handleUplinks();

app.get("/", async (req: Request, res: Response) => {
  let m3ters: object[] = [];
  for await (const value of db.values()) {
    m3ters.push(JSON.parse(value));
  }
  res.render("index", { m3ters });
});

app.post("/", async (req: Request, res: Response) => {
  try {
    const tokenId = (await req.body).tokenId;
    const contractId = await protocol.token_to_contract(tokenId);
    const _publicKey = await m3ter.token_to_key(tokenId);
    const publicKey = encodeBase64(_publicKey).toString();
    await db.put(publicKey, JSON.stringify({ publicKey, tokenId, contractId }));
  } catch (err) {
    console.error(err);
  }
  res.redirect("/");
});

app.delete("/", async (req: Request, res: Response) => {
  await db.del(await req.body);
  res.send("M3ter Deleted").status(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`[server]: Server is running at port ${process.env.PORT}`);
});
