import * as WakuSDK from "@waku/sdk";

// @ts-ignore
import * as Waku from "nodejs-waku"

export const createM3teringNode = async () => {
   const peers = ["/ip4/127.0.0.1/tcp/60060/p2p/16Uiu2HAmL9RHPdaweVRsusuxF4wfY4N6aXUvjegQ3Dgx2Y8oSRq2"]

   const config = {
      n: "<node_id>",
      userAgent: "m3tering-node",
      bootstrapPeers: peers,
      libp2p: {
         filterMultiaddrs: false,
      },
      networkConfig: {
         clusterId: 1,
         contentTopics: ["/waku/2/test/proto"],
      },
   }
   const node = await WakuSDK.createLightNode({
      ...config,
      defaultBootstrap: false,
   })

   return node
}

export const getWakuNode = () => {
   Waku.wakuNew(`{

      "host": "0.0.0.0",
      "port": 60001,
      "key": "364d111d729a6eb6d2e6113e163f017b5ef03a6f94c9b5b7bb1bb36fa5cb07a9",
      "relay": true
   }`)

   Waku.wakuVersion();

   // Example on how to retrieve a value from the waku library
   var defaultPubsubTopic = ""
   Waku.wakuDefaultPubsubTopic(function (msg: any) { defaultPubsubTopic = msg })

   console.log("Default pubsub topic: " + defaultPubsubTopic)

   console.log("Setting callback event callback function")
   // Waku.wakuSetEventCallback(event_handler)

   Waku.wakuStart()

   Waku.wakuConnect("/ip4/127.0.0.1/tcp/60060/p2p/16Uiu2HAmL9RHPdaweVRsusuxF4wfY4N6aXUvjegQ3Dgx2Y8oSRq2",
      10000,
      function onErr(msg: any) {
         console.log("Error connecting node: " + msg)
      })

}