import cron from "node-cron";
import { Hooks } from "../../../types";
import { getAllMeterRecords } from "../../../store/sqlite";
import { loadConfigurations } from "../../utils";
import { pruneAndSyncOnchain } from "../../sync";

export default class implements Hooks {
  private config = loadConfigurations();

  async onAfterInit() {
    console.log("Registering prune_sync cron job...");

    // Schedule a cron job to perform prune verified transactions and sync with onchain state
    cron.schedule(this.config.prune_sync.cronSchedule, async () => {
      const m3ters = getAllMeterRecords();
      for (const m3ter of m3ters) {
        try {
          pruneAndSyncOnchain(m3ter.publicKey);
        } catch (error) {
          console.error(`Error pruning and syncing meter ${m3ter.publicKey}:`, error);
        }
      }
    });

    console.log("prune_sync cron job registered.");
    return;
  }
}
