import { getAllTransactionRecords, getMeterByDevEui } from "../../../store/sqlite";
import { buildBatchPayload, retry } from "../../utils";
import { managedRole, publishManaged } from '../../../central/distribution';
import { lastPublish, recordPublish } from './state';
import type { UIHooks, UIAppIcon, UIAppWindow, UIAction, TransactionRecord, UIStatusContext } from "../../../types";
import { StreamrClient } from "@streamr/sdk";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("[streamr-ui]");

const { ETHEREUM_PRIVATE_KEY } = process.env;

// Configuration values are text content in the extension's HTML presentation.
function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

/**
 * Streamr UI Module
 * Provides UI components for the Streamr integration, including
 * a panel showing stream configuration and a manual publish action
 */
export default class implements UIHooks {
  private streamIds: string[] = process.env.STREAMR_STREAM_ID ? process.env.STREAMR_STREAM_ID.split(",") : [];
  private cronSchedule: string = process.env.STREAMR_CRONSCHEDULE || "0 * * * *";

  getAppIcon(): UIAppIcon {
    return {
      id: "streamr",
      label: "Streamr",
      iconHtml: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8m8-8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>',
      buttonClass: "is-primary",
    };
  }

  async getAppWindow(): Promise<UIAppWindow> {
    // First paint; /js/streamr.js keeps it current and follows the tab's gateway on central.
    const status = await this.status();
    const gateway = status.role === 'gateway';
    return {
      id: "streamr",
      title: "Streamr Publisher",
      containerClass: "",
      contentHtml: `
        <div class="page-heading">
          <div><span class="eyebrow">STREAMR NETWORK</span><h2>Keep the data flowing.</h2>
          <p>Publish your pending meter transactions to connected streams.</p></div>
          <span class="count-badge" data-streamr-field="badge">${gateway ? "Central publishes" : `${status.pendingCount} pending`}</span>
        </div>
        <p class="section-description" data-streamr-field="scope">${escapeHtml(status.scope)}</p>
        <div class="publisher-summary">
          <div class="publisher-stat"><span data-streamr-field="pending-label">${gateway ? "Readings kept here" : "Waiting to publish"}</span><strong data-streamr-field="pending">${gateway ? status.recordCount : status.pendingCount}</strong>
          <small data-streamr-field="uncertain">${status.uncertainCount ? `${status.uncertainCount} with an uncertain outcome (not resent automatically)` : ""}</small></div>
          <div class="publisher-stat"><span>Last publish</span><strong data-streamr-field="last">${status.lastPublishTime ? new Date(status.lastPublishTime).toLocaleString() : "Never"}</strong>
          <small data-streamr-field="last-status">${status.lastPublishStatus ? (status.lastPublishStatus === "success" ? "Published successfully" : "Publish failed") : ""}</small></div>
        </div>
        <section class="publisher-config"><h3>Configuration</h3>
          <div class="setting-row"><span>Publish schedule</span><code>${escapeHtml(this.cronSchedule)}</code></div>
          <h3>Connected streams</h3>
          <ul class="stream-list">${this.streamIds.map((id) => `<li><span class="status-dot" aria-hidden="true"></span><code>${escapeHtml(id)}</code></li>`).join("") || '<li>No streams configured.</li>'}</ul>
        </section>
        <div class="publisher-actions">
          <button class="nes-btn is-primary" data-streamr-field="publish" onclick="invokeAction('streamr', 'publish-now', this)" ${!status.canPublish || status.pendingCount === 0 ? "disabled" : ""} ${gateway ? "hidden" : ""}>Publish Now</button>
          <button class="nes-btn" onclick="window.StreamrApp ? StreamrApp.refresh() : location.reload()">Refresh</button>
        </div>
      `,
    };
  }

  getActions(): UIAction[] {
    return [
      {
        id: "publish-now",
        label: "Publish Now",
        buttonClass: "is-warning",
        handler: async () => {
          if (process.env.CONSOLE_ROLE === 'gateway') return { message: 'Central publishes for managed gateways. Readings here are kept for reconciliation.' };
          const pendingTransactions = await this.getPendingTransactions();

          if (pendingTransactions.length === 0) {
            return { message: "No pending transactions to publish" };
          }

          try {
            await Promise.all(
              this.streamIds.map(async (streamId) => {
                logger.info(`Publishing to stream: ${streamId}`);
                await retry(() => this.publishToStreamr(streamId, pendingTransactions), 3, 2000);
              }),
            );

            recordPublish("success", pendingTransactions.length);

            return {
              message: managedRole() ? `Published ${pendingTransactions.length} reading(s) not yet confirmed on-chain, for every gateway, to ${this.streamIds.length} stream(s)` : `Published ${pendingTransactions.length} transactions to ${this.streamIds.length} stream(s)`,
              data: { count: pendingTransactions.length },
            };
          } catch (error: any) {
            recordPublish("error");
            throw new Error(`Failed to publish: ${error.message}`);
          }
        },
      },
    ];
  }

  async getStatusData(context?: UIStatusContext): Promise<Record<string, any>> {
    return this.status(context);
  }

  /** What the window shows: readings not yet confirmed on-chain, which every publish (re)sends.
   * Central: optionally only one gateway's meters. A managed gateway: central publishes. */
  async status(context: UIStatusContext = {}) {
    const role = (process.env.CONSOLE_ROLE || "standalone") as "standalone" | "central" | "gateway";
    let records = await this.getPendingTransactions();
    if (context.devEuis) {
      const tokens = new Set(context.devEuis.map((devEui) => getMeterByDevEui(devEui)?.tokenId).filter((id) => id !== undefined));
      records = records.filter((record) => tokens.has(record.identifier));
    }
    const scope = role === "gateway" ? "This gateway is managed by central, which publishes its readings to Streamr."
      : role === "central" ? (context.gateway ? `Showing readings from ${context.gatewayName || "this gateway"}'s meters. Central publishes for every gateway together.`
        : "Showing readings from every gateway. Central publishes them on the schedule below.")
      : "";
    return {
      role, scope, gateway: context.gateway || null,
      recordCount: records.length,
      // Readings stay until the chain confirms their nonce, and each publish sends all of them.
      pendingCount: role === "gateway" ? 0 : records.length,
      uncertainCount: 0,
      canPublish: role !== "gateway" && this.streamIds.length > 0,
      streamIds: this.streamIds, cronSchedule: this.cronSchedule,
      lastPublishTime: lastPublish.time, lastPublishStatus: lastPublish.status,
    };
  }

  private async getPendingTransactions(): Promise<TransactionRecord[]> {
    return getAllTransactionRecords();
  }

  private async publishToStreamr(streamId: string, pendingTransactions: TransactionRecord[]) {
    if (managedRole()) return publishManaged(`streamr:${streamId}`, pendingTransactions, records => this.publishBatch(streamId, records));
    return this.publishBatch(streamId, pendingTransactions);
  }

  private async publishBatch(streamId: string, pendingTransactions: TransactionRecord[]) {
    if (!ETHEREUM_PRIVATE_KEY) {
      throw new Error("Missing ETHEREUM_PRIVATE_KEY");
    }

    const streamrClient = new StreamrClient({
      auth: { privateKey: ETHEREUM_PRIVATE_KEY },
    });

    try {
      const stream = await retry(() => streamrClient.getStream(streamId), 3, 2000);
      const batchPayload = buildBatchPayload(pendingTransactions);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // wait for 2 seconds to ensure connection is established
      await stream.publish(batchPayload);
      await new Promise((resolve) => setTimeout(resolve, 100000)); // wait for 100 seconds to ensure message is sent
      logger.info(`Published ${pendingTransactions.length} transactions to stream ${streamId}`);
    } catch (error) {
      logger.error(`Error publishing to Streamr:`, error);
      throw error;
    } finally {
      try {
        await streamrClient.destroy();
      } catch (destroyError) {
        logger.error(`Error destroying client:`, destroyError);
      }
    }
  }
}
