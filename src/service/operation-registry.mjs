// Trusted gateway operation definitions. Engine handlers remain the final authority.
export const MANAGEMENT_ROUTES = {
 '/v1/automations/setup': 'automation.setup',
 '/v1/profiles': 'profile.create', '/v1/profiles/update': 'profile.update',
 '/v1/rules': 'rule.create', '/v1/rules/update': 'rule.update',
 '/v1/automations': 'automation.create', '/v1/automations/pause': 'pause',
 '/v1/automations/resume': 'resume', '/v1/automations/cancel': 'cancel',
 '/v1/automations/trigger': 'enqueue',
};
export const details = {
 'automation.setup': ['automation:write + profile:write + rule:write', 'Save a paused public-context or separately approved AI-template automation with its project profile and rule, atomically.', 'name, projectId, idempotencyKey, connectionId (optional approved AI connection), intervalSeconds (optional: 3600, 21600 or 86400)'],
 'profile.create': ['profile:write', 'Save a project selection.', 'selection'],
 'profile.update': ['profile:write', 'Update a saved selection with revision conflict protection.', 'id, selection, expectedRevision'],
 'rule.create': ['rule:write', 'Create a versioned rule for allowed projects and tools.', 'projectIds, tools, enabled, name (optional)'],
 'rule.update': ['rule:write', 'Append a new rule version; current rules apply at execution.', 'id, projectIds, tools, enabled, expectedVersion, name (optional)'],
 'automation.create': ['automation:write', 'Create a paused automation with a manual, schedule or event trigger.', 'profileId, ruleId, projectId, tool, trigger'],
 pause: ['automation:write', 'Pause an automation; queued work remains held.', 'id'],
 resume: ['automation:write', 'Enable an automation; a schedule starts a new interval.', 'id'],
 cancel: ['automation:write', 'Cancel an automation and its queued/retrying runs. Cancellation is terminal.', 'id'],
 enqueue: ['automation:write', 'Queue a run of an active automation; duplicate keys return the same run.', 'id, idempotencyKey, event (for event triggers)'],
};
const string={type:"string"}, integer={type:"integer"}, object={type:"object"}, strings={type:"array",items:string};
const schema=(properties,required=[])=>({type:"object",properties,required,additionalProperties:false});
export const OPERATION_DEFINITIONS = {
 "automation.setup":{inputSchema:schema({name:{type:"string",maxLength:100},projectId:string,idempotencyKey:string,connectionId:string,intervalSeconds:{type:"integer",enum:[3600,21600,86400]}},["projectId","idempotencyKey"]),permissions:["automation:write","profile:write","rule:write"],sideEffect:"configuration"},
 "profile.create":{inputSchema:schema({selection:object},["selection"]),permissions:["profile:write"],sideEffect:"configuration"},
 "profile.update":{inputSchema:schema({id:string,selection:object,expectedRevision:integer},["id","selection","expectedRevision"]),permissions:["profile:write"],sideEffect:"configuration"},
 "rule.create":{inputSchema:schema({id:string,expectedVersion:integer,name:string,projectIds:strings,tools:strings,enabled:{type:"boolean"}},["projectIds","tools","enabled"]),permissions:["rule:write"],sideEffect:"configuration"},
 "rule.update":{inputSchema:schema({id:string,expectedVersion:integer,name:string,projectIds:strings,tools:strings,enabled:{type:"boolean"}},["id","expectedVersion","projectIds","tools","enabled"]),permissions:["rule:write"],sideEffect:"configuration"},
 "automation.create":{inputSchema:schema({name:string,profileId:string,ruleId:string,projectId:string,tool:{enum:["get_bittrees_project"]},trigger:object},["profileId","ruleId","projectId","tool","trigger"]),permissions:["automation:write"],sideEffect:"configuration"},
 history:{inputSchema:schema({limit:{type:"integer",minimum:1,maximum:100},cursor:string,auditCursor:string}),permissions:["automation:read"],sideEffect:"read"},
 "ai.retry":{inputSchema:schema({runId:string,confirmed:{const:true}},["runId","confirmed"]),permissions:["automation:write"],sideEffect:"execution-request"},
 enqueue:{inputSchema:schema({id:string,idempotencyKey:string,event:string},["id","idempotencyKey"]),permissions:["automation:write"],sideEffect:"execution-request"},
 ...Object.fromEntries(["pause","resume","cancel"].map(operation=>[operation,{inputSchema:schema({id:string},["id"]),permissions:["automation:write"],sideEffect:"lifecycle"}])),
};
for(const [handler,definition] of Object.entries(OPERATION_DEFINITIONS)){
 definition.handler=handler;
 definition.route=Object.entries(MANAGEMENT_ROUTES).find(([,op])=>op===handler)?.[0]??(handler==='history'?'/v1/history':handler==='ai.retry'?'/v1/ai/runs/retry':null);
 definition.availability=handler==='ai.retry'?'configured-ai-connection-and-current-authority':'scoped-workspace-permission';
}
export const MANAGEMENT_TOOLS = [
  {name:"automation_setup",description:"Save a paused automation with its selection and rule in one request. Enabling and execution require separate current permission.",
    inputSchema:OPERATION_DEFINITIONS["automation.setup"].inputSchema,
    permission:"automation:write",permissions:["automation:write","profile:write","rule:write"],operation:"automation.setup",sideEffect:"configuration"},
  {
    name: "automation_history",
    description:
      "Read your selected automation definitions, runs and audit history.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    permission: "automation:read",
    operation: "history",
  },
  ...["trigger", "pause", "resume", "cancel"].map((action) => ({
    name: `automation_${action}`,
    description: `${action} an existing automation within this project selection. Execution requires current permission and any source-specific consent.`,
    inputSchema: OPERATION_DEFINITIONS[action === "trigger" ? "enqueue" : action].inputSchema,
    permission: "automation:write",
    operation: action === "trigger" ? "enqueue" : action,
  })),
];

export const operationPermission = operation => OPERATION_DEFINITIONS[operation]?.permissions[0] ?? "automation:write";
