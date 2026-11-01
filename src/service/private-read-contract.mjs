import {canonical} from './roles-proof.mjs';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const HEX=/^[a-f0-9]{64}$/;
export const INSIGHTS_AUDIENCE='https://insights.bittrees.org/api/integrations/ai';
export const MAIL_AUDIENCE='https://mail.bittrees.org/api/integrations/mcp';
export const deny=()=>{throw Object.assign(Error('Approved private read connection and current authority required'),{statusCode:403});};
export function exact(value,required,optional=[]){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))deny();
}
const selectProperties={siteIds:{type:'array',minItems:1,maxItems:20,uniqueItems:true,items:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'}},days:{type:'integer',enum:[7,30,90]},path:{type:'string',maxLength:300},traffic:{type:'string',enum:['all','people','likely_human','ai_agent','automation','unknown']}};
export const insightsSchema=exporting=>({type:'object',properties:{...selectProperties,...(exporting?{dataset:{type:'string',enum:['summary','trend','pages','products']},format:{type:'string',enum:['json','csv']}}:{})},required:exporting?['siteIds','dataset','format']:['siteIds'],additionalProperties:false});
export function insightsSelection(v,exporting){
 const schema=insightsSchema(exporting);exact(v,schema.required,Object.keys(schema.properties).filter(k=>!schema.required.includes(k)));
 if(!Array.isArray(v.siteIds)||v.siteIds.length<1||v.siteIds.length>20||new Set(v.siteIds).size!==v.siteIds.length||v.siteIds.some(s=>typeof s!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s)))deny();
 for(const k of ['days','traffic','dataset','format'])if(v[k]!==undefined&&!schema.properties[k]?.enum?.includes(v[k]))deny();
 if(v.path!==undefined&&(typeof v.path!=='string'||v.path.length>300||v.path&&(!v.path.startsWith('/')||v.path.startsWith('//')||/[?#\\\x00-\x20]/.test(v.path))))deny();
 return {siteIds:[...v.siteIds],days:v.days??30,path:v.path??'',traffic:v.traffic??'all',...(exporting?{dataset:v.dataset,format:v.format}:{})};
}
export function insightsContext(c,operation,selection){return {version:1,audience:INSIGHTS_AUDIENCE,connectionId:c.connectionId,connectionBindingDigest:c.connectionBindingDigest,operation,selection};}
export const mailSchema={type:'object',properties:{selection:{type:'object',properties:{id:{type:'string',pattern:'^[a-f0-9]{64}$'},folder:{type:'string',maxLength:60}},required:['id','folder'],additionalProperties:false},expectedVersion:{type:'string',pattern:'^[a-f0-9]{64}$'},content:{type:'string',enum:['metadata','plain']}},required:['selection','expectedVersion','content'],additionalProperties:false};
export function mailArguments(v){exact(v,mailSchema.required);exact(v.selection,['id','folder']);if(!HEX.test(v.selection.id)||!HEX.test(v.expectedVersion)||typeof v.selection.folder!=='string'||!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/.test(v.selection.folder)||v.selection.folder!==v.selection.folder.trim()||!['metadata','plain'].includes(v.content))deny();return structuredClone(v);}
export function mailContext(c,args,operationId){return {version:1,sourceAudience:MAIL_AUDIENCE,connectionId:c.connectionId,mailboxBinding:c.mailboxBinding,selectionRevision:c.selectionRevision,...args,operationId};}
export function mailChallenge(c,args,response,now){
 exact(response,['version','operationId','parameters','expiresAt']);
 if(response.version!==1||!UUID.test(response.operationId)||!Number.isSafeInteger(response.expiresAt)||response.expiresAt<=now||response.expiresAt>now+60000||response.expiresAt>c.expiresAt)deny();
 const expected=mailContext(c,args,response.operationId);if(canonical(response.parameters)!==canonical(expected))deny();return expected;
}
