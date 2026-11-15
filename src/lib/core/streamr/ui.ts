import { getAllTransactionRecords } from "../../../store/sqlite";
import { buildBatchPayload, retry } from "../../utils";
import type { UIHooks, UIAppIcon, UIAppWindow, UIAction, TransactionRecord } from "../../../types";
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
  private cronSchedule: string = process.env.STREAMR_CRONSCHEDULE || "Not configured";
  private lastPublishTime: Date | null = null;
  private lastPublishStatus: "success" | "error" | null = null;

  getAppIcon(): UIAppIcon {
    return {
      id: "streamr",
      label: "Streamr",
      iconHtml: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8m8-8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>',
      buttonClass: "is-primary",
    };
  }

  async getAppWindow(): Promise<UIAppWindow> {
    const pendingCount = (await this.getPendingTransactions()).length;
    const streamIds = this.streamIds;
    const cronSchedule = this.cronSchedule;

    return {
      id: "streamr",
      title: "Streamr Publisher",
      containerClass: "",
      contentHtml: `
        <div class="page-heading">
          <div><span class="eyebrow">STREAMR NETWORK</span><h2>Keep the data flowing.</h2>
          <p>Publish your pending meter transactions to connected streams.</p></div>
          <span class="count-badge">${pendingCount} pending</span>
        </div>
        <div class="publisher-summary">
          <div class="publisher-stat"><span>Pending transactions</span><strong>${pendingCount}</strong></div>
          <div class="publisher-stat"><span>Last publish</span><strong id="streamr-last-publish">${this.lastPublishTime ? this.lastPublishTime.toLocaleString() : "Never"}</strong>
          ${this.lastPublishStatus ? `<small>${this.lastPublishStatus === "success" ? "Published successfully" : "Publish failed"}</small>` : ""}</div>
        </div>
        <section class="publisher-config"><h3>Configuration</h3>
          <div class="setting-row"><span>Publish schedule</span><code>${escapeHtml(cronSchedule)}</code></div>
          <h3>Connected streams</h3>
          <ul class="stream-list">${streamIds.map((id) => `<li><span class="status-dot" aria-hidden="true"></span><code>${escapeHtml(id)}</code></li>`).join("") || '<li>No streams configured.</li>'}</ul>
        </section>
        <div class="publisher-actions">
          <button class="nes-btn is-primary" onclick="invokeAction('streamr', 'publish-now', this)" ${pendingCount === 0 ? "disabled" : ""}>Publish Now</button>
          <button class="nes-btn" onclick="location.reload()">Refresh</button>
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

            this.lastPublishTime = new Date();
            this.lastPublishStatus = "success";

            return {
              message: `Published ${pendingTransactions.length} transactions to ${this.streamIds.length} stream(s)`,
              data: { count: pendingTransactions.length },
            };
          } catch (error: any) {
            this.lastPublishStatus = "error";
            throw new Error(`Failed to publish: ${error.message}`);
          }
        },
      },
    ];
  }

  async getStatusData(): Promise<Record<string, any>> {
    const pendingTransactions = await this.getPendingTransactions();
    return {
      pendingCount: pendingTransactions.length,
      streamIds: this.streamIds,
      cronSchedule: this.cronSchedule,
      lastPublishTime: this.lastPublishTime,
      lastPublishStatus: this.lastPublishStatus,
    };
  }

  private async getPendingTransactions(): Promise<TransactionRecord[]> {
    return getAllTransactionRecords();
  }

  private async publishToStreamr(streamId: string, pendingTransactions: TransactionRecord[]) {
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
