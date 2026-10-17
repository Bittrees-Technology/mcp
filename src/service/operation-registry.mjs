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
export const MANAGEMENT_TOOLS = [
  {name:"automation_setup",description:"Save a paused automation with its selection and rule in one request. Enabling and execution require separate current permission.",
    inputSchema:{type:"object",properties:{name:{type:"string",maxLength:100},projectId:{type:"string"},idempotencyKey:{type:"string"},connectionId:{type:"string"},intervalSeconds:{type:"integer",enum:[3600,21600,86400]}},required:["projectId","idempotencyKey"],additionalProperties:false},
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
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        ...(action === "trigger"
          ? { idempotencyKey: { type: "string" }, event: { type: "string" } }
          : {}),
      },
      required: action === "trigger" ? ["id", "idempotencyKey"] : ["id"],
      additionalProperties: false,
    },
    permission: "automation:write",
    operation: action === "trigger" ? "enqueue" : action,
  })),
];

export const operationPermission = operation => operation === "history" ? "automation:read" : operation.startsWith("profile") ? "profile:write" : operation.startsWith("rule") ? "rule:write" : "automation:write";
