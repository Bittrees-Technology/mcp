import {feedAuthorized,createRoleFeed} from './role-feed-core.mjs';
import {validateCredentials} from './http.mjs';
export function credentialRoleFeed(env=process.env,now=Date.now()){
 const credentials=JSON.parse(env.MCP_CREDENTIALS_JSON||'[]');
 if(!Array.isArray(credentials)||credentials.length>1000)throw Error('Invalid credential configuration');
 validateCredentials(credentials);
 const rows=[];
 for(const actor of credentials){
  if(actor.projectIds.some(p=>typeof p!=='string'||p.length>100)||actor.permissions.some(p=>typeof p!=='string'||p.length>100))throw Error('Invalid credential scopes');
  for(const project of actor.projectIds)rows.push({identity:JSON.stringify([actor.tenant,actor.subject]),kind:'service',...(actor.expiresAt>now?{label:'Service identity'}:{}),scope:'project:'+project,permissions:actor.permissions.map(id=>({id,effect:actor.expiresAt>now?'allow':'deny',status:actor.expiresAt>now?'active':'suspended',expiresAt:new Date(actor.expiresAt).toISOString()}))});
 }
 return createRoleFeed('mcp.bittrees.org',rows,{env,now,coverageNote:'Configured tenant/subject service identities, project scopes, permissions and expiry. Tokens and token hashes are never exported. Execution also requires current profile/rule/adapter authorization; this feed does not execute jobs or evaluate those gates.'});
}
export function handleRoleFeed(req,res){
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(JSON.stringify(body));};
 if(req.method!=='GET')return send(405,{error:'Method not allowed'});
 if(!feedAuthorized(req.headers.authorization,process.env.ROLES_FEED_READ_TOKEN))return send(401,{error:'Feed authentication required'});
 try{return send(200,credentialRoleFeed());}catch{return send(503,{error:'Role feed unavailable'});}
}
