import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {createMcpHandler} from '../../src/service/http.mjs';import {Engine} from '../../src/service/engine.mjs';import {emptyState} from '../../src/service/store.mjs';
test('shared connection journey, scoped discovery and mobile layout',async({page})=>{
 const server=createServer(createMcpHandler({engine:new Engine({transaction:async fn=>fn(emptyState())})}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 await page.route('https://mcp.bittrees.org/**',async route=>{const req=route.request(),url=new URL(req.url()),headers={...req.headers()};delete headers.host;const r=await fetch(base+url.pathname+url.search,{method:req.method(),headers,...(req.postData()?{body:req.postData()}:{}),redirect:'manual'});await route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});});
 try{
 await page.goto('https://mcp.bittrees.org/connect?mode=selected&projects=crm');
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link')).toHaveCount(4);
 await expect(page.locator('#connection-url')).toHaveValue(/projects=crm/);
 await page.getByRole('button',{name:'Test connection',exact:true}).click();await expect(page.locator('#connection-result')).toContainText('Connected.');
 await page.locator('#project-filter').fill('CRM');await expect(page.locator('.project-choice:visible')).toHaveCount(1);
 for(const width of [1180,390]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/connect-${width}.png`,fullPage:true});}
 await page.goto('https://mcp.bittrees.org/explore');await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Explore'})).toHaveAttribute('aria-current','page');
 }finally{await new Promise(r=>server.close(r));}
});
