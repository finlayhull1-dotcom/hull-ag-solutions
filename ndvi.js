// Netlify Function: keep Copernicus OAuth credentials on the server.
const TOKEN_URL='https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const PROCESS_URL='https://sh.dataspace.copernicus.eu/api/v1/process';
const EVALSCRIPT=`//VERSION=3
function setup(){return {input:[{bands:["B04","B08","SCL","dataMask"]}],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
 if(!s.dataMask||[0,1,3,8,9,10,11].includes(s.SCL))return [0,0,0,0];
 let d=s.B08+s.B04, n=d===0?0:(s.B08-s.B04)/d;
 if(n<0)return [0.65,0.0,0.15,0.88];
 if(n<0.2)return [0.96,0.43,0.27,0.88];
 if(n<0.4)return [1,0.88,0.55,0.88];
 if(n<0.6)return [0.65,0.85,0.42,0.88];
 if(n<0.8)return [0.10,0.60,0.32,0.88];
 return [0,0.41,0.22,0.88];
}`;
export async function onRequestPost({request,env}){
 if(request.method!=='POST')return Response.json({error:'POST required'},{status:405});
 try{
  const {bbox,from,to}=await request.json();
  if(!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite)||bbox[0]>=bbox[2]||bbox[1]>=bbox[3]||bbox[0]<-180||bbox[2]>180||bbox[1]<-90||bbox[3]>90)return Response.json({error:'Invalid paddock bounds.'},{status:400});
  const area=(bbox[2]-bbox[0])*(bbox[3]-bbox[1]);if(area>1)return Response.json({error:'Area too large for this preview.'},{status:400});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return Response.json({error:'Invalid date range.'},{status:400});
  const id=env.SENTINEL_CLIENT_ID,secret=env.SENTINEL_CLIENT_SECRET;
  if(!id||!secret)return Response.json({error:'Missing Copernicus credentials in Cloudflare Pages secrets.'},{status:503});
  const params=new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret});
  const tokenResponse=await fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params});
  if(!tokenResponse.ok)return Response.json({error:'Copernicus authentication failed. Check credentials and account access.'},{status:502});
  const token=(await tokenResponse.json()).access_token;
  const ratio=Math.max(.15,Math.min(6,(bbox[2]-bbox[0])*Math.cos((bbox[1]+bbox[3])*Math.PI/360)/(bbox[3]-bbox[1])));
  const width=ratio>=1?768:Math.max(128,Math.round(768*ratio));const height=ratio>=1?Math.max(128,Math.round(768/ratio)):768;
  const payload={input:{bounds:{bbox,properties:{crs:'http://www.opengis.net/def/crs/EPSG/0/4326'}},data:[{type:'sentinel-2-l2a',dataFilter:{timeRange:{from:from+'T00:00:00Z',to:to+'T23:59:59Z'},mosaickingOrder:'leastCC',maxCloudCoverage:70}}]},output:{width,height,responses:[{identifier:'default',format:{type:'image/png'}}]},evalscript:EVALSCRIPT};
  const r=await fetch(PROCESS_URL,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'image/png'},body:JSON.stringify(payload)});
  if(!r.ok){const message=(await r.text()).slice(0,250);return Response.json({error:'Satellite service returned '+r.status+': '+message},{status:502})}
  return new Response(await r.arrayBuffer(),{headers:{'Content-Type':'image/png','Cache-Control':'private, max-age=600'}});
 }catch(e){return Response.json({error:'NDVI request error: '+e.message},{status:500})}
}
