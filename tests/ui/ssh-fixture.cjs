// Loopback-only SSH server exercising ssh2 transport and a real local shell/PTY.
const { Server } = require('ssh2');
const { generateKeyPairSync } = require('node:crypto');
const { spawn } = require('node:child_process');
module.exports = async function sshFixture() {
  const key = generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
  const server = new Server({hostKeys:[key]},client=>{
    client.on('error',()=>{});
    client.on('authentication',ctx=>{
      if(ctx.method==='password' && ctx.username==='fixture' && ctx.password==='fixture-password')ctx.accept();else ctx.reject();
    });
    client.on('ready',()=>client.on('session',accept=>{
      const session=accept();session.on('pty',accept=>accept());session.on('window-change',accept=>accept?.());
      session.on('shell',accept=>{
        const channel=accept(), shell=spawn('script',['-qec','/bin/sh','/dev/null'],{env:{...process.env,PS1:'fixture> '}});
        channel.pipe(shell.stdin);shell.stdout.pipe(channel);shell.stderr.pipe(channel.stderr);
        shell.on('error',()=>channel.end());shell.on('close',code=>{channel.exit(code||0);channel.end();});
        channel.on('close',()=>shell.kill());client.on('close',()=>shell.kill());
      });
    }));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,target:{host:'127.0.0.1',port:server.address().port}};
};
