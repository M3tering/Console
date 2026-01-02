import "dotenv/config";
import { handleUplinks } from "./logic/mqtt";
import { Request, Response } from "express";
import { app } from "./logic/context";
import setupDatabase, { getAllMeterRecords, deleteMeterByPublicKey } from "./store/sqlite";
import { initializeVerifiersCache } from "./logic/sync";
import { publishHeartbeatToStream } from "./logic/streamr";

// Async initialization function
async function initializeApp() {
  try {
    console.log("[info] Starting application initialization...");

    // Initialize database tables and jobs
    setupDatabase();
    console.log("[info] Database setup completed");

    // Initialize verifiers cache on startup 
    // (disable ccip read initialization)
    // await initializeVerifiersCache();
    // console.log("[info] Verifiers cache initialized successfully");

    // Start MQTT handling
    handleUplinks();
    console.log("[info] MQTT uplinks handler started");

    await publishHeartbeatToStream();

    console.log("[info] Application initialization completed successfully");
  } catch (error) {
    console.error("[fatal] Failed to initialize application:", error);
    process.exit(1);
  }
}

// Start initialization
initializeApp();

app.get("/", async (req: Request, res: Response) => {
  const m3ters = getAllMeterRecords();
  res.render("index", { m3ters });
  console.log("[server]: Server handled GET request at `/`");
});

app.delete("/delete-meter", async (req: Request, res: Response) => {
  let publicKey = decodeURIComponent(req.query?.publicKey?.toString() as string);
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
