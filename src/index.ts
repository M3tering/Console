import "dotenv/config";
import { encodeBase64 } from "ethers";
import { handleUplinks } from "./logic/mqtt";
import { Request, Response } from "express";
import { app, db, m3ter, protocol } from "./logic/context";

handleUplinks();

app.get("/", async (req: Request, res: Response) => {
  let m3ters: object[] = [];
  for await (const value of db.values()) {
    m3ters.push(JSON.parse(value));
  }
  res.render("index", { m3ters });
  console.log("[server]: Server handled GET request at `/`");
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
  console.log("[server]: Server handled POST request at `/`");
});

app.post("/:publicKey", async (req: Request, res: Response) => {
  await db.del((await req.params).publicKey);
  res.redirect("/");
  console.log("[server]: Server handled DELETE request at `/`");
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`[server]: Server is running at port ${process.env.PORT}`);
});
