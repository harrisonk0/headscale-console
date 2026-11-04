// UI-only failure injection: no production API, credentials or network devices.
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=new URL('../',import.meta.url);
const server=http.createServer((req,res)=>{
 res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':'text/html'});
 if(req.url==='/disk-store.js')return res.end(`export const ENGINE='test',BASE='test',DEVICE='test'; export class RemoteDisk {async claim(){this.lease='fixture';return null}async restore(){}async rpc(){return {}}}`);
 if(req.url==='/private-cache.js')return res.end('export async function preparePrivateCache(){} export function registerPrivateCache(){} export async function clearPrivateCache(){}');
 if(req.url==='/network.js')return res.end("export function configureNetwork(){throw Error('Injected engine startup failure')} export function prepareNetwork(){}");
 res.end(fs.readFileSync(new URL(req.url==='/'?'index.html':req.url.slice(1),root)));
}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>Object.defineProperty(window,'crossOriginIsolated',{value:true}));
 await page.route('**/api/remote/status',r=>r.fulfill({json:{authenticated:true}}));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 for(let attempt=0;attempt<2;attempt++){
  await page.locator('#launch').click();
  await page.waitForFunction(()=>document.getElementById('message').textContent==='Injected engine startup failure'&&!document.getElementById('launch').disabled);
  assert.equal(await page.locator('#start').isVisible(),true);
  assert.equal(await page.locator('#display').isVisible(),false);
  assert.equal(await page.locator('#launch').innerText(),'Retry desktop');
  assert.match(await page.locator('#save-status').innerText(),/last completed remote save is unchanged/);
 }
 console.log('PASS: startup errors reveal recovery controls; retry works without reloading or resetting remote files.');
}finally{await browser.close();server.close();}
