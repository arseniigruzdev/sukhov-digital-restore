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
const canonicalOrigin='https://sukhov-digital.ru';
const canonicalHost='sukhov-digital.ru';
const umamiOrigin='http://umami-z130tpk32zdxilgm3zptogxx.159.194.205.161.sslip.io';
const umamiId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(process.env.UMAMI_WEBSITE_ID||'')?process.env.UMAMI_WEBSITE_ID:null;
const umamiEnabled=mode==='production'&&!!umamiId;
const moeEnabled=mode==='production'&&process.env.MOEVIDEO_ENABLED==='1';
const moeLoaderMode=process.env.MOEVIDEO_LOADER_MODE==='direct'?'direct':'proxy';
const engagementScript=`<script>
window.setTimeout(function () {
  var attempts = 0;
  function sendEngagement() {
    if (window.umami && typeof window.umami.track === 'function') {
      window.umami.track('engaged-15-seconds', { seconds: 15 });
      return;
    }
    attempts += 1;
    if (attempts < 10) window.setTimeout(sendEngagement, 500);
  }
  sendEngagement();
}, 15000);
</script>`;
// Exact user-supplied asset; only script.src changes for verified first-party loading.
const moeSnippet=`<script type="text/javascript">
  (() => {
    const script = document.createElement("script");
    script.src = "https://cdn1.moe.video/p/cr.js";
    script.onload = () => {
      addContentRoll({
        width: '100%',
        placement: 10518,
        promo: true,
        advertCount: 50,
        slot: 'page',
        sound: 'onclick',
        reloadAfterClose: 20,
        deviceMode: 'all',
        background: 'none',
        fly: {
          mode: 'stick',
          width: 445,
          closeSecOffset: 10,
          position: 'bottom-right',
          indent: {
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
          },
          positionMobile: 'bottom',
        },
      });
    };
    document.body.append(script);
  })();
</script>`;
function integrateHtml(html){
 if(umamiEnabled)html=html.replace('</head>',`<script defer src="/static/js/main-core.js" data-host-url="/static/js" data-website-id="${umamiId}" data-domains="sukhov-digital.ru,www.sukhov-digital.ru"></script>${engagementScript}</head>`);
 if(moeEnabled)html=html.replace('</body>',(moeLoaderMode==='proxy'?moeSnippet.replace('script.src = "https://cdn1.moe.video/p/cr.js";','script.src = "/static/js/content-roll-loader.js";'):moeSnippet)+'</body>');
 return html;
}
async function proxy(req,res,url,isMoe){
 const methods=isMoe?['GET','HEAD']:['GET','HEAD','POST','OPTIONS'];
 if(!methods.includes(req.method)){res.writeHead(405,{'Allow':methods.join(', ')});res.end();return;}
 // Targets are fixed; request path/query can never choose an origin.
 const target=isMoe?'https://cdn1.moe.video/p/cr.js':umamiOrigin+url.pathname+url.search;
 const headers=new Headers();
 for(const name of ['user-agent','content-type','origin','referer'])if(req.headers[name])headers.set(name,req.headers[name]);
 if(!isMoe){
  const trusted=process.env.TRUST_PROXY_HEADERS!=='0'; // Production is exposed only through owner's private Dokploy ingress.
  const xff=trusted&&typeof req.headers['x-forwarded-for']==='string'?req.headers['x-forwarded-for']:null;
  const ip=trusted?(xff?.split(',')[0]?.trim()||req.headers['cf-connecting-ip']||req.headers['x-real-ip']):null;
  if(xff)headers.set('x-forwarded-for',xff);
  if(ip)for(const name of ['x-real-ip','cf-connecting-ip','true-client-ip','x-umami-client-ip'])headers.set(name,ip);
  headers.set('x-forwarded-host',req.headers.host||canonicalHost);
  const proto=trusted&&req.headers['x-forwarded-proto']?req.headers['x-forwarded-proto']:req.socket.encrypted?'https':'http';
  headers.set('x-forwarded-proto',proto);
 }
 try{
  let body;
  if(!['GET','HEAD'].includes(req.method)){
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   body=Buffer.concat(chunks);
  }
  const upstream=await fetch(target,{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(10000)});
  const responseHeaders={};
  for(const name of ['content-type','etag','last-modified'])if(upstream.headers.has(name))responseHeaders[name]=upstream.headers.get(name);
  // No Set-Cookie, auth, content encoding or upstream length forwarded after decompression.
  const cache=upstream.headers.get('cache-control')||'';
  responseHeaders['Cache-Control']=isMoe?(upstream.ok&&!/no-store|private/i.test(cache)?'public, max-age=300':'no-store'):'no-store';
  const content=req.method==='HEAD'?null:Buffer.from(await upstream.arrayBuffer());
  if(content&&content.length>4*1024*1024)throw new Error('Upstream response too large');
  if(content)responseHeaders['Content-Length']=content.length;
  res.writeHead(upstream.status,responseHeaders);res.end(content);
 }catch{
  if(!res.headersSent){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?'':'Bad gateway');}else res.end();
 }
}
function productionLocation(req,url,canonicalPath){
 // Dokploy passes the original Host and sets X-Forwarded-Proto on its private upstream.
 const forwarded=typeof req.headers['x-forwarded-proto']==='string'?req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase():null;
 const scheme=forwarded==='https'||forwarded==='http'?forwarded:req.socket.encrypted?'https':'http';
 let hostname;try{hostname=new URL('http://'+(req.headers.host||'')).hostname;}catch{hostname='';}
 return scheme!=='https'||hostname!==canonicalHost||url.pathname!==canonicalPath?canonicalOrigin+canonicalPath+url.search:null;
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 if(mode==='staging')res.setHeader('X-Robots-Tag','noindex, nofollow');
 let url;try{url=new URL(req.url,'http://localhost');}catch{res.writeHead(400);res.end();return;}
 const pathname=url.pathname;
 if(umamiEnabled&&['/static/js/main-core.js','/static/js/api/send'].includes(pathname)){await proxy(req,res,url,false);return;}
 if(moeEnabled&&pathname==='/static/js/content-roll-loader.js'){await proxy(req,res,url,true);return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
 if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?'':JSON.stringify({status:'ok',mode}));return;}
 if(mode==='production'){
   const alias=redirects.get(pathname);
   const canonicalPath=routes.get(pathname)?.status===200?pathname:alias&&routes.get(alias.to)?.status===200?alias.to:null;
   if(canonicalPath){const location=productionLocation(req,url,canonicalPath);if(location){res.writeHead(301,{'Location':location});res.end();return;}}
 }
 if(redirects.has(pathname)){const r=redirects.get(pathname);res.writeHead(r.status,{'Location':r.to+url.search});res.end();return;}
 let route=routes.get(pathname);
 let file=route?.file,status=route?.status||404;
 if(!route&&(resources.has(pathname.slice(1))||/^\/assets\/[a-zA-Z0-9._-]+$/.test(pathname))){file=pathname.slice(1);status=200;}
 if(!file)file='404.html';
 try{
   let content=await readFile(path.join(root,file));
   if(mode==='production'&&status===200&&!route){const location=productionLocation(req,url,pathname);if(location){res.writeHead(301,{'Location':location});res.end();return;}}
   const ext=path.extname(file),type=types[ext]||'application/octet-stream';
   if(ext==='.html'){
    let html=content.toString().replace(noindex,mode==='staging'||status!==200?noindex:'<meta name="robots" content="index, follow">');
    if(mode==='production'&&status===200)html=integrateHtml(html);
    content=Buffer.from(html);
   }
   if(pathname==='/robots.txt')content=Buffer.from(`User-agent: *\n${mode==='staging'?'Disallow: /':'Allow: /'}\nSitemap: ${manifest.canonicalBase}/sitemap.xml\n`);
   res.writeHead(status,{'Content-Type':type,'Content-Length':content.length,'Cache-Control':ext==='.html'||pathname==='/robots.txt'?'no-cache':'public, max-age=3600'});res.end(req.method==='HEAD'?'':content);
 }catch(error){
   if(error.code!=='ENOENT'){console.error('Read failed',file,error.code);}
   const content=await readFile(path.join(root,'404.html'),'utf8');
   res.writeHead(404,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?'':content);
 }
});
server.listen(port,'0.0.0.0',()=>console.log(`Serving on port ${port}; SITE_MODE=${mode}`));
