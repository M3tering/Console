import fs from "fs";
import path from "path";
import { createPublicKey, verify } from "crypto";
import type {
  TransactionRecord,
  BatchTransactionPayload,
  Hooks,
  AppConfig,
  UIHooks,
  UIAppIcon,
  UIAppWindow,
  UIAction,
} from "../types";

const extensions: Hooks[] = [];
const uiExtensions: Map<string, UIHooks> = new Map();
export const defaultConfigurations: AppConfig = {
  modules: ["core/arweave", "core/prover", "core/streamr", "core/is_on", "core/prune_sync"],
  uiModules: {
    streamr: "core/streamr/ui",
  },
  streamr: {
    streamId: ["0x567853282663b601bfdb9203819b1fbb3fe18926/m3tering/test"],
    cronSchedule: "0 * * * *",
  },
  prune_sync: {
    cronSchedule: "0 * * * *",
  },
};

export function loadConfigurations(configPath: string = "console.config.json"): AppConfig {
  try {
    const config: AppConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config;
  } catch (error) {
    console.warn(`Could not load configuration from ${configPath}, using default configurations.`);
    return defaultConfigurations;
  }
}

export async function loadExtensionsFromConfig(configPath: string = "console.config.json"): Promise<Hooks[]> {
  const config: AppConfig = loadConfigurations(configPath);

  for (const modulePath of config.modules) {
    const resolved = path.resolve(__dirname, modulePath);

    const mod = await import(resolved);
    extensions.push(new mod.default());
  }

  return extensions;
}

export async function runHook<K extends keyof Hooks>(hook: K, ...args: Parameters<NonNullable<Hooks[K]>>) {
  let result: ReturnType<NonNullable<Hooks[K]>> | boolean = true;

  for (const ext of extensions) {
    const fn = ext[hook];
    let functionReturn;
    if (fn) functionReturn = await (fn as any).call(ext, ...args);

    if (typeof functionReturn === "boolean" && hook === "isOnStateCompute") {
      result = result && functionReturn;
    }
  }

  return result;
}

// ==========================================
// UI Extension System
// ==========================================

/**
 * Load UI extensions from configuration file
 * Looks for 'uiModules' key in config, which maps module IDs to their paths
 */
export async function loadUIExtensionsFromConfig(
  configPath: string = "console.config.json",
): Promise<Map<string, UIHooks>> {
  const config = loadConfigurations(configPath) as AppConfig & { uiModules?: Record<string, string> };

  if (!config.uiModules) {
    console.log("[ui] No UI modules configured");
    return uiExtensions;
  }

  for (const [moduleId, modulePath] of Object.entries(config.uiModules)) {
    try {
      const resolved = path.resolve(__dirname, modulePath);
      const mod = await import(resolved);
      const instance = new mod.default();
      uiExtensions.set(moduleId, instance);
      console.log(`[ui] Loaded UI module: ${moduleId}`);
    } catch (error) {
      console.error(`[ui] Failed to load UI module ${moduleId}:`, error);
    }
  }

  return uiExtensions;
}

/**
 * Get all UI components (icons, windows, actions) from loaded UI extensions
 */
export async function getUIComponents(): Promise<{
  icons: UIAppIcon[];
  windows: UIAppWindow[];
  actions: Map<string, UIAction[]>;
}> {
  const icons: UIAppIcon[] = [];
  const windows: UIAppWindow[] = [];
  const actions: Map<string, UIAction[]> = new Map();

  for (const [moduleId, ext] of uiExtensions) {
    try {
      if (ext.getAppIcon) {
        const icon = await ext.getAppIcon();
        icons.push(icon);
      }
      if (ext.getAppWindow) {
        const window = await ext.getAppWindow();
        windows.push(window);
      }
      if (ext.getActions) {
        const moduleActions = await ext.getActions();
        actions.set(moduleId, moduleActions);
      }
    } catch (error) {
      console.error(`[ui] Error getting components from ${moduleId}:`, error);
    }
  }

  return { icons, windows, actions };
}

/**
 * Get a specific UI extension by module ID
 */
export function getUIExtension(moduleId: string): UIHooks | undefined {
  return uiExtensions.get(moduleId);
}

/**
 * Invoke an action from a UI module
 */
export async function invokeUIAction(
  moduleId: string,
  actionId: string,
): Promise<{ success: boolean; message?: string; data?: any }> {
  const ext = uiExtensions.get(moduleId);
  if (!ext) {
    return { success: false, message: `Module '${moduleId}' not found` };
  }

  if (!ext.getActions) {
    return { success: false, message: `Module '${moduleId}' has no actions` };
  }

  const actions = await ext.getActions();
  const action = actions.find((a) => a.id === actionId);

  if (!action) {
    return { success: false, message: `Action '${actionId}' not found in module '${moduleId}'` };
  }

  try {
    const result = await action.handler();
    return {
      success: true,
      message: result?.message || `Action '${actionId}' executed successfully`,
      data: result?.data,
    };
  } catch (error: any) {
    return { success: false, message: error.message || "Action failed" };
  }
}

/**
 * Retries a function up to 5 times with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries (default: 5)
 * @param baseDelay Base delay in milliseconds (default: 1000)
 * @returns Promise that resolves with the function result or rejects with the last error
 */
export async function retry<T>(fn: () => Promise<T>, maxRetries: number = 5, baseDelay: number = 1000): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

export function buildBatchPayload(transactions: TransactionRecord[]): BatchTransactionPayload[] {
  return transactions.map((transaction) => ({
    m3ter_id: Number(transaction.identifier),
    message: transaction.raw,
  }));
}

export function verifyPayloadSignature(transaction: Buffer, rawPubKey: Buffer): boolean {
  try {
    const message = transaction.subarray(0, 8);
    const signature = transaction.subarray(8, 72);

    // Wrap raw key in SPKI DER
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const derKey = Buffer.concat([new Uint8Array(spkiPrefix), new Uint8Array(rawPubKey)]);

    const publicKey = createPublicKey({
      key: derKey,
      format: "der",
      type: "spki",
    });

    // Verify
    const ok = verify(null, new Uint8Array(message), publicKey, new Uint8Array(signature));

    return ok;
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
}
