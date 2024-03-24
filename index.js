require("dotenv").config()

const express = require('express')
const connect = require('mqtt').connect

const app = express()
const port = 3000

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

const client = connect({
    host: process.env.CHIRPSTACK_HOST,
    port: 1883,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000,
});

watchMqttClient(client)

function watchMqttClient(client) {
    client.on("connect", () => {
        client.subscribe(`application/${process.env.APPLICATION_ID}/device/+/event/up`, () => {
            console.log("\nConnected & Subscribed\n");
        });
    });
    
    client.on("message", async (topic, payload) => {
        const payloadData = JSON.parse(payload.toString());
        const devEui = payloadData["deviceInfo"]["devEui"];
        const rawData = payloadData["data"];
    
        if (rawData && devEui) {
        const data = Buffer.from(rawData, "base64").toString();
        try {
            const result = await interact(
            "hiRzb5bqHuS7xH2gULudlREuq6P_uARjo6bGM2pHMek",
            data
            );
            // enqueue(devEui, result);
        } catch (error) {
            console.log("\nDecoded data:\n", data);
        }
        }
    });
}