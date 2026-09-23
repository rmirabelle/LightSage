import dgram from 'node:dgram';
import { writeFile } from 'node:fs/promises';
import { localCandidates } from './local-pairing.mjs';
const addresses = [...new Set((await localCandidates()).flat().filter(ip=>ip.startsWith('10.')))];
const socket = dgram.createSocket('udp4'), devices = new Map();
socket.on('message',(bytes,remote)=>{
  try {
    const data=JSON.parse(bytes).msg;
    if(data?.cmd !== 'scan') return;
    devices.set(remote.address,{ip:remote.address,...data.data});
  } catch {}
});
await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(4002,'0.0.0.0',resolve);});
try {
  socket.setMulticastInterface('10.0.0.250');
  const packet=Buffer.from(JSON.stringify({msg:{cmd:'scan',data:{account_topic:'reserve'}}}));
  for(let round=0;round<3;round++) {
    for(const ip of ['239.255.255.250',...addresses]) socket.send(packet,4001,ip);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const result={at:new Date().toISOString(),queried:addresses.length,devices:[...devices.values()]};
  await writeFile(new URL('./.state/lan-discovery.json',import.meta.url),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {socket.close();}
