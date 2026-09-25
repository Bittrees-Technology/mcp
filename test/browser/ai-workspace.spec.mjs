import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { FileStore } from '../../src/service/store.mjs';
import { Engine } from '../../src/service/engine.mjs';
import { createMcpHandler } from '../../src/service/http.mjs';
import { AiConnections } from '../../src/service/ai-connections.mjs';
import { AiSecrets } from '../../src/service/ai-secrets.mjs';
import { AiWorker } from '../../src/service/ai-worker.mjs';
import { CATALOG } from '../../src/ecosystem/catalog.mjs';

test('connect an approved template, save paused, run and disconnect in the workspace', async ({ page }, info) => {
 const directory = await mkdtemp(join(tmpdir(), 'mcp-browser-'));
 const token = 'synthetic-workspace-key', ownerId = randomUUID(), templateId = randomUUID(), deviceId = randomUUID(), permissionId = randomUUID();
 const actor = { tenant:'test', subject:'operator', audience:'https://mcp.bittrees.org', expiresAt:Date.now()+3600000, projectIds:['agent'], permissions:['catalog:read','profile:read','profile:write','rule:write','automation:read','automation:write','automation:execute'], tokenHash:createHash('sha256').update(token).digest('hex') };
 const store = new FileStore(join(directory,'state.json'));
 const connections = new AiConnections(store, { secrets:new AiSecrets(randomBytes(32).toString('base64url')), client:{
  begin:async input=>({id:input.id,requestExpiresAt:Date.now()+300000}),
  redeem:async input=>({credential:randomBytes(32).toString('base64url'),grant:{id:input.id,clientId:'bittrees-mcp',actor:input.actor,ownerId,permissionId,deviceId,templateId,templateRevision:1,maxRuns:2,expiresAt:Date.now()+300000,redeemed:true,revoked:false}}),
  disconnect:async()=>({revoked:true}),
 }});
 const receipt = input=>({id:input.command.id,grantId:input.grantId,permissionId:input.permissionId,state:'accepted'});
 const engine = new Engine(store,{aiWorker:new AiWorker(store,{transport:{submit:async input=>receipt(input),inspect:async input=>receipt(input)},resolveActor:()=>actor,catalog:CATALOG})});
 const server=createServer(createMcpHandler({engine,credentials:[actor],aiConnections:connections}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 // Serve the real handler at its configured browser origin, with only the AI
 // peer simulated. No live credentials, remote AI or persistent browser data.
 await page.route('https://mcp.bittrees.org/**',async route=>{
  const request=route.request();const headers={...request.headers()};delete headers.host;
  const response=await fetch(base+new URL(request.url()).pathname,{method:request.method(),headers,...(request.postData()?{body:request.postData()}:{}),redirect:'manual'});
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 try {
  await page.goto('https://mcp.bittrees.org/automations');
  await page.locator('#token').fill(token);await page.locator('#login button').click();
  await page.getByRole('button',{name:'Connect an AI template',exact:true}).click();
  await expect(page.locator('#ai-approval-code')).not.toHaveValue('');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#ai-approval-code')).toHaveValue('');
  await page.locator('#ai-owner').fill(ownerId);await page.locator('#ai-confirmed').check();
  await page.getByRole('button',{name:'Finish connection',exact:true}).click();
  await expect(page.locator('#ai-connections')).toContainText('connected');
  await page.locator('#automation-connection').selectOption({label:`Approved AI template · ${templateId.slice(0,8)}`});
  await page.locator('#automation-name').fill('My approved template');
  await page.getByRole('button',{name:'Save paused automation',exact:true}).click();
  await expect(page.locator('#automations')).toContainText('Paused');
  for(const width of [1180,390]){
   await page.setViewportSize({width,height:900});
   await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`test-results/ai-workspace-${width}.png`,fullPage:true});
  }
  await page.getByRole('button',{name:'Enable automation',exact:true}).click();
  await page.getByRole('button',{name:'Run now',exact:true}).click();
  await engine.tick(()=>actor);await page.locator('#refresh').click();
  await expect(page.locator('#activity')).toContainText('Accepted by AI');
  await page.getByRole('button',{name:'Disconnect AI template…',exact:true}).click();
  await page.locator('#confirm-dialog button[value="cancel"]').click();
  await expect(page.locator('#ai-connections')).toContainText('disconnected');
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
