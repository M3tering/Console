// UI preview only. All MQTT and REST endpoints are local simulators, never real meters.
module.exports = async function attachManagerPreview(app, server) {
  process.env.M3TER_MANAGER_USERNAME = 'demo';
  process.env.M3TER_MANAGER_PASSWORD = 'demo-manager';
  const { requireManagerAuth, managerAuthenticated } = require('../../dist/m3ter/auth');
  const store = require('../../dist/store/sqlite');
  const database = `manager-preview-${process.pid}.db`;
  store.default(database); process.on('exit',()=>store.deleteDatabase(database));
  await require('./manager-fixture.cjs')(app);
  const { commandCatalogue } = require('../../dist/m3ter/commands');
  const { monitoring, managerEvents, inactiveMilliseconds } = require('../../dist/m3ter/monitor');
  app.get('/api/m3ter-manager/config',requireManagerAuth,(_req,res)=>res.json({commands:commandCatalogue,monitoring,inactiveMilliseconds:inactiveMilliseconds(),demo:true}));
  app.use('/api/m3ter-manager',require('../../dist/m3ter/api').managerRouter);
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({noServer:true});
  server.on('upgrade',(req,socket,head)=>{
    if (req.url !== '/m3ter-manager/live' || !managerAuthenticated(req)) {socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  const send = (ws,data)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));};
  wss.on('connection',(ws,req)=>{ ws.managerRequest=req; send(ws,{type:'connection',monitoring}); });
  managerEvents.on('update',data=>{for(const ws of wss.clients) { if(managerAuthenticated(ws.managerRequest))send(ws,data); else ws.close(4001,'Sign in required'); }});
};
