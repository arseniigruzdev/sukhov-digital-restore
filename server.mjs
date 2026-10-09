import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const mode=process.env.SITE_MODE==='production'?'production':'staging';
const port=Number(process.env.PORT||4173);
const manifest=JSON.parse(await readFile(path.join(root,'routes.json'),'utf8'));
const routes=new Map(manifest.routes.map(r=>[r.path,r]));
const redirects=new Map(manifest.redirects.map(r=>[r.from,r]));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const resources=new Set(['robots.txt','sitemap.xml','llms.txt','llms-full.txt','site.webmanifest']);
const noindex='<meta name="robots" content="noindex, nofollow">';
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 if(mode==='staging')res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
 let url;try{url=new URL(req.url,'http://localhost');}catch{res.writeHead(400);res.end();return;}
 const pathname=url.pathname;
 if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?'':JSON.stringify({status:'ok',mode}));return;}
 if(redirects.has(pathname)){const r=redirects.get(pathname);res.writeHead(r.status,{'Location':r.to+url.search});res.end();return;}
 let route=routes.get(pathname);
 let file=route?.file,status=route?.status||404;
 if(!route&&(resources.has(pathname.slice(1))||/^\/assets\/[a-zA-Z0-9._-]+$/.test(pathname))){file=pathname.slice(1);status=200;}
 if(!file)file='404.html';
 try{
   let content=await readFile(path.join(root,file));
   const ext=path.extname(file),type=types[ext]||'application/octet-stream';
   if(ext==='.html')content=Buffer.from(content.toString().replace(noindex,mode==='staging'||status!==200?noindex:'<meta name="robots" content="index, follow">'));
   if(pathname==='/robots.txt')content=Buffer.from(`User-agent: *\n${mode==='staging'?'Disallow: /':'Allow: /'}\nSitemap: ${manifest.canonicalBase}/sitemap.xml\n`);
   res.writeHead(status,{'Content-Type':type,'Content-Length':content.length,'Cache-Control':ext==='.html'||pathname==='/robots.txt'?'no-cache':'public, max-age=3600'});res.end(req.method==='HEAD'?'':content);
 }catch(error){
   if(error.code!=='ENOENT'){console.error('Read failed',file,error.code);}
   const content=await readFile(path.join(root,'404.html'),'utf8');
   res.writeHead(404,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?'':content);
 }
});
server.listen(port,'0.0.0.0',()=>console.log(`Serving on port ${port}; SITE_MODE=${mode}`));
