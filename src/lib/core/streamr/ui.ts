import { getAllTransactionRecords } from "../../../store/sqlite";
import { buildBatchPayload, loadConfigurations, retry } from "../../utils";
import type { UIHooks, UIAppIcon, UIAppWindow, UIAction, TransactionRecord } from "../../../types";
import { StreamrClient } from "@streamr/sdk";

const { ETHEREUM_PRIVATE_KEY } = process.env;

/**
 * Streamr UI Module
 * Provides UI components for the Streamr integration, including
 * a panel showing stream configuration and a manual publish action
 */
export default class implements UIHooks {
  private config = loadConfigurations();
  private lastPublishTime: Date | null = null;
  private lastPublishStatus: "success" | "error" | null = null;

  getAppIcon(): UIAppIcon {
    return {
      id: "streamr",
      label: "Streamr",
      iconHtml: '<i class="nes-icon star is-medium"></i>',
      buttonClass: "is-primary",
    };
  }

  async getAppWindow(): Promise<UIAppWindow> {
    const pendingCount = (await this.getPendingTransactions()).length;
    const streamIds = this.config.streamr.streamId;
    const cronSchedule = this.config.streamr.cronSchedule;

    return {
      id: "streamr",
      title: "Streamr Publisher",
      containerClass: "",
      contentHtml: `
        <div class="nes-container with-title">
          <p class="title">Configuration</p>
          <div style="margin-bottom: 15px;">
            <strong>Cron Schedule:</strong> 
            <span class="nes-text is-primary">${cronSchedule}</span>
          </div>
          <div style="margin-bottom: 15px;">
            <strong>Stream IDs:</strong>
            <ul class="nes-list is-disc" style="margin-left: 20px;">
              ${streamIds.map((id) => `<li style="font-size: 10px; word-break: break-all;">${id}</li>`).join("")}
            </ul>
          </div>
        </div>
        
        <div class="nes-container with-title" style="margin-top: 15px;">
          <p class="title">Status</p>
          <div style="margin-bottom: 15px;">
            <strong>Pending Transactions:</strong> 
            <span class="nes-text ${pendingCount > 0 ? "is-warning" : "is-success"}">${pendingCount}</span>
          </div>
          <div style="margin-bottom: 15px;">
            <strong>Last Publish:</strong> 
            <span id="streamr-last-publish">${this.lastPublishTime ? this.lastPublishTime.toLocaleString() : "Never"}</span>
            ${this.lastPublishStatus ? `<span class="nes-text ${this.lastPublishStatus === "success" ? "is-success" : "is-error"}">(${this.lastPublishStatus})</span>` : ""}
          </div>
        </div>
        
        <div style="margin-top: 15px;">
          <button 
            class="nes-btn is-warning" 
            onclick="invokeAction('streamr', 'publish-now', this)"
            ${pendingCount === 0 ? "disabled" : ""}
          >
            Publish Now
          </button>
          <button 
            class="nes-btn" 
            onclick="location.reload()"
          >
            <i class="nes-icon is-small"></i> Refresh
          </button>
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
            for (const streamId of this.config.streamr.streamId) {
              console.log(`[streamr-ui] Publishing to stream: ${streamId}`);
              await retry(() => this.publishToStreamr(streamId, pendingTransactions), 3, 2000);
            }

            this.lastPublishTime = new Date();
            this.lastPublishStatus = "success";

            return {
              message: `Published ${pendingTransactions.length} transactions to ${this.config.streamr.streamId.length} stream(s)`,
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
      streamIds: this.config.streamr.streamId,
      cronSchedule: this.config.streamr.cronSchedule,
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
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await stream.publish(batchPayload);
      console.log(`[streamr-ui] Published ${pendingTransactions.length} transactions to stream ${streamId}`);
    } catch (error) {
      console.error(`[streamr-ui] Error publishing to Streamr:`, error);
    } finally {
      await streamrClient.destroy();
    }
  }
}
