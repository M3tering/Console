import { credentials, Metadata } from "@grpc/grpc-js";
import { DeviceServiceClient } from "@chirpstack/chirpstack-api/api/device_grpc_pb";
import { DeviceQueueItem, EnqueueDeviceQueueItemRequest, GetDeviceQueueItemsRequest } from "@chirpstack/chirpstack-api/api/device_pb";
import type { ChirpstackQueue } from '../central/coordinator';
import { createLogger } from "../utils/logger";
import { describeReply } from "../utils/report-log";

const logger = createLogger("[grpc]");

let deviceService: DeviceServiceClient | undefined;
function client(): DeviceServiceClient {
  return deviceService ??= new DeviceServiceClient(`${process.env.CHIRPSTACK_HOST}:8080`, credentials.createInsecure());
}

const metadata = new Metadata();
metadata.set("authorization", "Bearer " + process.env.API_TOKEN);

export function enqueue(devEui: string, data: number[]): Promise<void> {
  const item = new DeviceQueueItem();
  const enqueueReq = new EnqueueDeviceQueueItemRequest();

  item.setFPort(2);
  item.setDevEui(devEui);
  item.setConfirmed(false);
  item.setData(new Uint8Array(data));

  enqueueReq.setQueueItem(item);
  return new Promise((resolve, reject) => {
    client().enqueue(enqueueReq, metadata, (err, resp) => {
      if (err || !resp) { reject(err || new Error("Missing enqueue response")); return; }
      logger.info(`Reply enqueued to ChirpStack for ${devEui} (queue id ${resp.getId()}): ${describeReply(data)}`);
      resolve();
    });
  });
}

/** Agent-only adapter: fixed FPort 2 replies, queue inspection and a bounded RPC
 * deadline. A deadline error is ambiguous; the coordinator never retries it. */
export const managedQueue: ChirpstackQueue = {
  list: devEui => new Promise((resolve,reject) => {
    const request=new GetDeviceQueueItemsRequest();request.setDevEui(devEui);
    client().getQueue(request,metadata,{deadline:Date.now()+8000},(error,response)=>{
      if(error||!response){reject(new Error('ChirpStack queue inspection failed.'));return;}
      resolve(response.getResultList().map(item=>({id:item.getId(),devEui:item.getDevEui(),fPort:item.getFPort(),confirmed:item.getConfirmed(),bytes:Array.from(item.getData_asU8())})));
    });
  }),
  enqueue: decision => new Promise((resolve,reject)=>{
    if(decision.fPort!==2||decision.confirmed||![9,13].includes(decision.bytes.length)||![0,1].includes(decision.bytes[0])){reject(new Error('Invalid state reply.'));return;}
    const item=new DeviceQueueItem();item.setDevEui(decision.devEui);item.setFPort(2);item.setConfirmed(false);item.setData(Uint8Array.from(decision.bytes));
    const request=new EnqueueDeviceQueueItemRequest();request.setQueueItem(item);
    client().enqueue(request,metadata,{deadline:Date.now()+8000},(error,response)=>{
      if(error||!response){reject(new Error('ChirpStack enqueue outcome is uncertain.'));return;}
      resolve(response.getId());
    });
  }),
};
