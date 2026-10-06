// Exercise the packaged payload using fresh state and separate ports; never touches live lights.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fork, execFileSync } = require('node:child_process');
const https = require('node:https');
(async () => {
  const root = path.resolve(__dirname, '../dist/win-unpacked/resources');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lightsage-packaged-'));
  let child;
  try {
    execFileSync(path.join(root, 'desktop/runtime/python/python.exe'), ['-I', '-c', 'import bleak; from winrt.windows.devices.bluetooth import BluetoothLEDevice'], { windowsHide:true });
    const controller = path.join(root, 'tools/matter-probe');
    child = fork(path.join(controller, 'server.mjs'), [], {execPath:path.join(root,'desktop/runtime/node.exe'),cwd:controller,windowsHide:true,env:{...process.env,LIGHTSAGE_STATE_DIR:dir,LIGHTSAGE_HTTP_PORT:'3542',LIGHTSAGE_HTTPS_PORT:'3543',LIGHTSAGE_SETUP_PORT:'3544'},stdio:['ignore','pipe','pipe','ipc']});
    let logs='';child.stdout.on('data', b => logs+=b);child.stderr.on('data', b => logs+=b);
    const ready = await new Promise((resolve,reject)=> { const timer=setTimeout(()=>reject(Error('Startup timed out: '+logs)),30000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);resolve(m);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Exited '+code+': '+logs));}); });
    assert.match(ready.setupUrl, /:3544$/);
    const ca = await fs.readFile(path.join(dir,'tls/root.crt'));
    const code=(await fs.readFile(path.join(dir,'access-code.txt'),'utf8')).trim();
    const response=await new Promise((resolve,reject)=>{ const req=https.request({hostname:'127.0.0.1',port:3543,path:'/api/session',method:'POST',ca,headers:{Origin:'https://127.0.0.1:3543','Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(JSON.stringify({code})); });
    assert.equal(response,200);
    const setup=await fetch('http://127.0.0.1:3544');assert.equal(setup.status,200);assert.match(await setup.text(),/LightSage phone setup/);
    const exited=new Promise(resolve=>child.once('exit',resolve));child.send({type:'shutdown'});assert.equal(await exited,0);child=null;
    console.log('PASS: packaged Node, isolated Python/Bluetooth imports, fresh controller identity, automatic TLS, HTTPS authentication, phone setup, and graceful shutdown.');
  } finally { if(child && child.exitCode === null && child.signalCode === null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;} await fs.rm(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
