import "dotenv/config";
import { encodeBase64 } from "ethers";
import { handleUplinks } from "./logic/mqtt";
import { Request, Response } from "express";
import { app, m3ter, protocol } from "./logic/context";
import setupDatabase, {
  getAllMeterRecords,
  saveMeter,
  deleteMeterByPublicKey,
} from "./store/sqlite";

handleUplinks();

// Initialize database tables and jobs
setupDatabase();

app.get("/", async (req: Request, res: Response) => {
  const m3ters = getAllMeterRecords();
  res.render("index", { m3ters });
  console.log("[server]: Server handled GET request at `/`");
});

app.post("/", async (req: Request, res: Response) => {
  try {
    const tokenId = (await req.body).tokenId;
    const contractId = await protocol.contractByToken(tokenId);
    const _publicKey = await m3ter.keyByToken(tokenId);
    const publicKey = encodeBase64(_publicKey).toString();
    saveMeter({
      publicKey,
      tokenId,
      contractId,
      latestNonce: 0,
    });
  } catch (err) {
    console.error(err);
  }
  res.redirect("/");
  console.log("[server]: Server handled POST request at `/`");
});

app.delete("/delete-meter", async (req: Request, res: Response) => {
  let publicKey = decodeURIComponent(
    req.query?.publicKey?.toString() as string
  );
  if (publicKey) {
    const deleted = deleteMeterByPublicKey(publicKey.toString());
    if (!deleted) {
      res.status(404).send({ message: "meter not found" });
      return;
    }
  } else {
    res.status(400).send({ message: "public key not specified" });
    return;
  }
  console.log("[server]: Server handled DELETE request at `/delete-meter`");
  res.status(200).send({ message: "deleted meter" });
});
