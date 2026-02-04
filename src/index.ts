import "dotenv/config";
import { handleUplinks } from "./services/mqtt";
import { Request, Response } from "express";
import { app } from "./services/context";
import {
  loadExtensionsFromConfig,
  loadUIExtensionsFromConfig,
  getUIComponents,
  invokeUIAction,
  runHook,
} from "./lib/utils";
import setupDatabase, { getAllMeterRecords, deleteMeterByPublicKey } from "./store/sqlite";

// Async initialization function
async function initializeApp() {
  try {
    console.log("[info] Starting application initialization...");

    // Load extensions from config
    await loadExtensionsFromConfig();
    console.log("[info] Extensions loaded successfully");

    // Load UI extensions
    await loadUIExtensionsFromConfig();
    console.log("[info] UI extensions loaded successfully");

    runHook("onBeforeInit");

    // Initialize database tables and jobs
    setupDatabase();
    console.log("[info] Database setup completed");

    runHook("onDatabaseSetup");

    try {
      // Start MQTT handling
      await handleUplinks();
    } catch (mqttError) {
      console.error("[error] MQTT initialization failed:", mqttError);
      throw mqttError;
    }

    console.log("[info] Application initialization completed successfully");

    runHook("onAfterInit");
  } catch (error) {
    console.error("[fatal] Failed to initialize application:", error);
    runHook("onInitError", error);
    process.exit(1);
  }
}

// Start initialization
initializeApp();

app.get("/", async (req: Request, res: Response) => {
  const m3ters = getAllMeterRecords();

  // Get UI components from loaded UI extensions
  const { icons, windows } = await getUIComponents();

  res.render("index", { m3ters, icons, windows });
  console.log("[server]: Server handled GET request at `/`");
});

// API endpoint to invoke UI actions
app.post("/api/actions/:moduleId/:actionId", async (req: Request, res: Response) => {
  const { moduleId, actionId } = req.params;
  console.log(`[server]: Invoking action '${actionId}' from module '${moduleId}'`);

  const result = await invokeUIAction(moduleId, actionId);

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(400).json(result);
  }
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
