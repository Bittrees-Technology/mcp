const endpoints = {
  crm: {origin:'https://crm.bittrees.org', actions:{brief:'/api/integrations/leads/brief',preview:'/api/integrations/leads/prepare',status:'/api/integrations/leads/status'}},
  mercado:{origin:'https://mercado.bittrees.org',actions:{preview:'/api/integrations/coordinator/preview',status:'/api/integrations/coordinator/status'}}
};
const deny=()=>{throw Object.assign(new Error('Source connection unavailable'),{statusCode:403});};
export class SourceConnections {
  constructor(connections=[], request=fetch) { this.connections=connections; this.request=request; }
  connection(actor, source, projects) {
    if (!actor || !actor.permissions.includes('sources:propose') || !projects.includes(source) || !actor.projectIds.includes(source)) return deny();
    const c=this.connections.find(c=>c.tenant===actor.tenant && c.subject===actor.subject && c.actorTokenHash===actor.tokenHash && c.source===source);
    if (!c || !Number.isFinite(c.expiresAt) || c.expiresAt<=Date.now() || !/^[a-f0-9]{64}$/.test(c.token)) return deny();
    return c;
  }
  list(actor, projects) {
    return Object.entries(endpoints).flatMap(([source,endpoint])=>{
      try {this.connection(actor,source,projects);}catch{return [];}
      return Object.keys(endpoint.actions).map(action=>({name:`source_${source}_${action}`,description:`${action} a scoped ${source} proposal. Source-app review remains required.`,inputSchema:{type:'object',properties:action==='brief'?{}:{operationId:{type:'string',format:'uuid'},...(action==='preview'?(source==='crm'?{candidates:{type:'array',maxItems:20}}:{product:{type:'object'}}):{})},required:action==='brief'?[]:['operationId',...(action==='preview'?[source==='crm'?'candidates':'product']:[])],additionalProperties:false}}));
    });
  }
  async call(actor,projects,name,args) {
    const tool=this.list(actor,projects).find(t=>t.name===name);
    if (!tool || !args || Array.isArray(args) || Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k))) return deny();
    const [,source,action]=name.split('_');
    const c=this.connection(actor,source,projects), e=endpoints[source];
    const response=await this.request(e.origin+e.actions[action],{method:'POST',headers:{authorization:`Bearer ${c.token}`,'content-type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Object.assign(new Error('Source rejected request; check connection, scope and proposal'),{statusCode:response.status});
    const raw=await response.text();
    if(raw.length>120000) throw new Error('Source response too large');
    return JSON.parse(raw);
  }
}
