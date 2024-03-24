import "dotenv/config";

import { connect } from "mqtt";
import { interact } from "@/interact";
import { credentials, Metadata } from "@grpc/grpc-js";
import { DeviceServiceClient } from "@chirpstack/chirpstack-api/api/device_grpc_pb";
import {
  DeviceQueueItem,
  EnqueueDeviceQueueItemRequest,
} from "@chirpstack/chirpstack-api/api/device_pb";

// Create the client for the DeviceService.
const deviceService = new DeviceServiceClient(
  `${process.env.CHIRPSTACK_HOST}:8080`,
  credentials.createInsecure()
);

const metadata = new Metadata();
metadata.set("authorization", "Bearer " + process.env.API_TOKEN);

function enqueue(devEui, data) {
  const item = new DeviceQueueItem();
  const enqueueReq = new EnqueueDeviceQueueItemRequest();

  item.setDevEui(devEui);
  item.setFPort(2);
  item.setConfirmed(true);
  item.setData(new Uint8Array(data));

  enqueueReq.setQueueItem(item);
  deviceService.enqueue(enqueueReq, metadata, (err, resp) => {
    if (err !== null) return console.log(err);
    console.log("Downlink has been enqueued with id: " + resp.getId());
  });
}




