// Test infrastructure only: an HTTP ChirpStack REST stub and a real TCP MQTT broker.
const http = require('node:http');
const net = require('node:net');
const { randomUUID, generateKeyPairSync, sign } = require('node:crypto');
const mqttPacket = require('mqtt-packet');
const application = '11111111-1111-4111-8111-111111111111';
const devices = [
  { devEui: '0102030405060708', name: 'Cumulus · Workshop' },
  { devEui: '1112131415161718', name: 'Cumulus · Solar room' },
  { devEui: '2122232425262728', name: 'Cumulus · Awaiting installation' },
];
module.exports = async function managerFixture(app) {
  process.env.APPLICATION_ID = application;
  process.env.API_TOKEN = 'fixture-backend-token-never-in-browser';
  const { ingestEvent } = require('../../dist/m3ter/monitor');
  const keys = new Map(devices.map(device => [device.devEui, generateKeyPairSync('ed25519')]));
  const queues = new Map(devices.map(device => [device.devEui, []]));
  let collectorCount = 0;
  let enqueueCount = 0, listFailure = false, queueFailure = false;
  const rest = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const reply = (data, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${process.env.API_TOKEN}`) { reply({error:'Unauthorized'},401); return; }
    const url = new URL(req.url,'http://fixture');
    if (url.pathname === '/api/devices') {
      if (listFailure) { reply({error:'Unavailable'},503); return; }
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const matches = devices.filter(device => (device.name + device.devEui).toLowerCase().includes(search));
      reply({ totalCount:matches.length, result:matches.map(device => ({...device,deviceProfileName:'Switch Cumulus',deviceProfileId:'profile-1'})) }); return;
    }
    if (url.pathname.startsWith('/api/device-profiles/')) { reply({deviceProfile:{name:'Switch Cumulus'}}); return; }
    if (url.pathname.startsWith('/api/applications/')) { reply({application:{name:'Workshop network'}}); return; }
    const match = url.pathname.match(/^\/api\/devices\/([a-f0-9]{16})(\/queue)?$/);
    if (!match) { reply({},404); return; }
    const id = match[1], device = devices.find(device => device.devEui === id);
    if (!device) { reply({device:{devEui:id,applicationId:'22222222-2222-4222-8222-222222222222'} }); return; }
    if (!match[2]) { reply({device:{...device,applicationId:application,deviceProfileId:'profile-1',tags:{phaseMode:'phase-a'},variables:{private:'must-not-leak'}},enabledClass:'CLASS_C'}); return; }
    if (queueFailure) { reply({error:'upstream failure'},503); return; }
    if (req.method === 'GET') { reply({totalCount:queues.get(id).length,result:queues.get(id)}); return; }
    if (req.method === 'DELETE') { queues.set(id,[]); reply({}); return; }
    let data = ''; req.on('data', chunk => data += chunk); req.on('end', () => {
      const { queueItem } = JSON.parse(data); enqueueCount++; queues.get(id).push({...queueItem,isPending:true}); reply({id:queueItem.id});
    });
  });
  await new Promise(resolve => rest.listen(0,'127.0.0.1',resolve));
  process.env.CHIRPSTACK_REST_URL = `http://127.0.0.1:${rest.address().port}`;
  const clients = new Set();
  const broker = net.createServer(socket => {
    const parser = mqttPacket.parser(); socket.on('data', data => parser.parse(data)); socket.on('error',()=>{});
    socket.on('close',()=>clients.delete(socket)); parser.on('error',()=>socket.destroy());
    const send = packet => socket.write(mqttPacket.generate(packet));
    parser.on('packet', packet => {
      if (packet.cmd === 'connect') send({cmd:'connack',returnCode:0,sessionPresent:false});
      if (packet.cmd === 'subscribe') { clients.add(socket); send({cmd:'suback',messageId:packet.messageId,granted:packet.subscriptions.map(()=>1)}); }
      if (packet.cmd === 'pingreq') send({cmd:'pingresp'});
      if (packet.cmd === 'disconnect') socket.end();
    });
  });
  await new Promise(resolve => broker.listen(0,'127.0.0.1',resolve));
  const { handleUplinks, stopUplinks } = require('../../dist/services/mqtt');
  process.env.MQTT_URL = `mqtt://127.0.0.1:${broker.address().port}`;
  await handleUplinks(undefined, async () => { collectorCount++; });
  function uplink(input = {}) {
    const id = input.devEui || devices[0].devEui, key = keys.get(id);
    const bytes = Buffer.alloc(input.length || ((input.nonce ?? 0) === 0 ? 106 : 74)); if (bytes.length >= 74) {
      bytes.writeUInt32BE(input.nonce ?? 0,0); bytes.writeUInt32BE(Math.round((input.energy ?? 12.345678)*1e6),4);
      sign(null,bytes.subarray(0,8),key.privateKey).copy(bytes,8); bytes.writeUInt16BE(Math.round((input.voltage ?? 230.1)*10),72);
      if (bytes.length === 106) key.publicKey.export({format:'der',type:'spki'}).subarray(-32).copy(bytes,74);
    }
    return { deduplicationId:input.eventId || randomUUID(), time:new Date(input.timestamp || Date.now()).toISOString(),
      deviceInfo:{ devEui:id, applicationId:application, deviceName:devices.find(d=>d.devEui===id).name, applicationName:'Workshop network',deviceProfileName:'Switch Cumulus' },
      ...(input.encoding === 'hex' ? {data:bytes.toString('hex').toUpperCase(),dataEncoding:'hex'} : input.encoding === 'dataHex' ? {dataHex:bytes.toString('hex').toUpperCase()} : {data:bytes.toString('base64')}), fPort:input.fPort ?? 2, fCnt:input.nonce ?? 0, rxInfo:[{rssi:-70,snr:9.5,gatewayId:'aabbccddeeff0011'}] };
  }
  for (let i=0;i<80;i++) {
    const event = uplink({nonce:i<40?1:2,energy:i<40?10+i*.01:(i-40)*.02,voltage:229+i%5,timestamp:Date.now()-(80-i)*60000});
    ingestEvent(`application/${application}/device/${event.deviceInfo.devEui}/event/up`,Buffer.from(JSON.stringify(event)));
  }
  const second = uplink({devEui:devices[1].devEui,energy:7.5,voltage:235});
  ingestEvent(`application/${application}/device/${second.deviceInfo.devEui}/event/up`,Buffer.from(JSON.stringify(second)));
  app.post('/__test/manager', (req,res) => {
    const body = req.body || {};
    if (body.action === 'stats') { res.json({enqueueCount,collectorCount,clients:clients.size}); return; }
    if (body.action === 'list-failure') { listFailure = !!body.value; res.json({ok:true}); return; }
    if (body.action === 'queue-failure') { queueFailure = !!body.value; res.json({ok:true}); return; }
    if (body.action === 'disconnect') { for (const socket of clients) socket.destroy(); res.json({ok:true}); return; }
    const event = body.kind && body.kind !== 'up' ? { deduplicationId:randomUUID(),time:new Date().toISOString(),deviceInfo:{devEui:body.devEui || devices[0].devEui,applicationId:application},queueItemId:body.queueItemId,acknowledged:body.acknowledged,location:body.location } : uplink(body);
    const topic = `application/${application}/device/${event.deviceInfo.devEui}/event/${body.kind || 'up'}`;
    const payload = body.action === 'malformed' ? '{' : JSON.stringify(event);
    for (const socket of clients) socket.write(mqttPacket.generate({cmd:'publish',topic,payload,qos:0,retain:false,dup:false}));
    res.json({event});
  });
  app.on('close', () => { stopUplinks(); for(const socket of clients) socket.destroy(); broker.close(); rest.close(); });
};
