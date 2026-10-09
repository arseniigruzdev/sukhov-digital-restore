import {readFile,mkdir,writeFile} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
const target=path.resolve(process.env.ASSET_OUTPUT_ROOT||'.');
const manifest=JSON.parse(await readFile('encoded-assets/manifest.json','utf8'));
for(const item of manifest){
 if(!/^public\/assets\/[a-zA-Z0-9._-]+$/.test(item.path))throw new Error('Invalid asset path');
 const chunks=await Promise.all(item.chunks.map(p=>readFile(path.join('encoded-assets',p),'utf8')));
 const bytes=Buffer.from(chunks.join(''),'base64');
 if(bytes.length!==item.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Asset mismatch '+item.path);
 const file=path.join(target,item.path);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);
 const readback=await readFile(file);
 if(crypto.createHash('sha256').update(readback).digest('hex')!==item.sha256)throw new Error('Readback mismatch '+item.path);
 console.log(item.path+' sha256='+item.sha256+' bytes='+item.bytes);
}
