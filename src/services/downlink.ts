/** A state reply for one signed usage report, not a technician command API. */
export interface StateDownlink {
  devEui: string;
  fPort: 2;
  confirmed: false;
  bytes: number[];
}
export type DownlinkSink = (decision: StateDownlink) => Promise<void>;
