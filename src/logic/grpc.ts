import { credentials, Metadata } from "@grpc/grpc-js";
import { DeviceServiceClient } from "@chirpstack/chirpstack-api/api/device_grpc_pb";
import {
  DeviceQueueItem,
  EnqueueDeviceQueueItemRequest,
} from "@chirpstack/chirpstack-api/api/device_pb";

const deviceService = new DeviceServiceClient(
  `${process.env.CHIRPSTACK_HOST}:8080`,
  credentials.createInsecure()
);

const metadata = new Metadata();
metadata.set("authorization", "Bearer " + process.env.API_TOKEN);

export function enqueue(devEui: string, data: number[]) {
  const item = new DeviceQueueItem();
  const enqueueReq = new EnqueueDeviceQueueItemRequest();

  item.setFPort(2);
  item.setDevEui(devEui);
  item.setConfirmed(true);
  item.setData(new Uint8Array(data));

  enqueueReq.setQueueItem(item);
  deviceService.enqueue(enqueueReq, metadata, (err: any, resp: any) => {
    if (err !== null) return console.log(err);
    console.log(`${data} has been enqueued with id: ` + resp.getId());
  });
}
