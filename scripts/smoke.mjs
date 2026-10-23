// Tests the packaged executable using disposable data only. Never uses ./data.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const binary=path.resolve(process.argv[2]||'bin/duet-ledger');
const root=await mkdtemp(path.join(tmpdir(),'duet-ledger-artifact-'));
const processes=[];
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function start(data){const port=await freePort();const url=`http://127.0.0.1:${port}`;const child=spawn(binary,['serve','--data-dir',data,'--listen',`127.0.0.1:${port}`],{stdio:['ignore','ignore','pipe'],env:{...process.env,DUET_LEDGER_PUBLIC_URL:'',DUET_LEDGER_SECURE_COOKIE:'false'}});let errors='';child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});processes.push(child);for(let i=0;i<60;i++){try{const r=await fetch(url+'/healthz');if(r.ok)return {url,child};}catch{}if(child.exitCode!==null)throw new Error('packaged server exited early: '+errors);await delay(50);}throw new Error('server not ready');}
async function stop(child){if(child.exitCode!==null)return;child.kill('SIGTERM');await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('shutdown timeout'));},5000);child.once('exit',()=>{clearTimeout(timeout);resolve();});});}
function client(url){let cookie='',csrf='';return {get cookie(){return cookie;},set cookie(v){cookie=v;},async request(method,route,body,status=200){const r=await fetch(url+'/api'+route,{method,headers:{'Content-Type':'application/json',Origin:url,'X-CSRF-Token':csrf,Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,status,`${method} ${route}`);const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];const data=await r.json();if(data.csrf)csrf=data.csrf;return data;}};}
try{
 const data=path.join(root,'original');let app=await start(data);let c=client(app.url);assert.equal((await c.request('GET','/status')).initialized,false);
 const html=await (await fetch(app.url)).text();assert.ok(html.includes('듀엣 가계부'));const script=html.match(/src="([^"]+\.js)"/)[1];const asset=await fetch(app.url+script);assert.equal(asset.status,200);assert.ok(asset.headers.get('content-security-policy').includes("default-src 'self'"));
 for(const route of ['/home','/ledger','/stats','/accounts','/settings','/account','/admin']){const response=await fetch(app.url+route);assert.equal(response.status,200,route);assert.ok((await response.text()).includes('id="root"'));}
 const manifest=await (await fetch(app.url+'/manifest.webmanifest')).json();assert.equal(manifest.start_url,'/home');for(const size of [192,512]){const image=await fetch(app.url+`/icon-${size}.png`);assert.equal(image.status,200);assert.ok(image.headers.get('content-type').startsWith('image/png'));const png=Buffer.from(await image.arrayBuffer());assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
 const password=randomBytes(24).toString('base64url');await c.request('POST','/setup',{username:'smoke',name:'검증 사용자',password},201);
 const ledgers=await c.request('GET','/ledgers');const account=await c.request('POST','/accounts',{ledger_id:ledgers[0].id,name:'검증 통장',kind:'bank',currency:'KRW',scale:0,opening:'100000'},201);await c.request('POST','/transactions',{account_id:account.id,kind:'expense',date:'2026-10-22',amount:'12000',title:'검증 지출',category:'food',note:''},201);
 await c.request('PUT','/me/exchange-rates',{from:'USD',to:'KRW',rate:'1400'});await c.request('POST','/transactions',{account_id:account.id,kind:'expense',date:'2026-10-23',amount:'28000',title:'외화 구독',category:'food',note:'',original_currency:'USD',original_amount:'2000',exchange_rate:'1400'},201);
 assert.equal((await c.request('GET','/accounts'))[0].balance,'60000');const backup=await c.request('POST','/backups',{},201);const oldCookie=c.cookie;await stop(app.child);
 app=await start(data);c=client(app.url);c.cookie=oldCookie;await c.request('POST','/setup',{username:'lateuser',name:'늦은 가입',password},409);assert.equal((await c.request('GET','/accounts'))[0].balance,'60000');await stop(app.child);
 const target=path.join(root,'restored');const restored=spawnSync(binary,['restore','--archive',path.join(data,'backups',backup.name),'--key-file',path.join(data,'master.key'),'--data-dir',target],{encoding:'utf8'});assert.equal(restored.status,0,restored.stderr);
 const restoreApp=await start(target);const restoredClient=client(restoreApp.url);restoredClient.cookie=oldCookie;await restoredClient.request('GET','/me',undefined,401);await restoredClient.request('POST','/login',{username:'smoke',password});assert.equal((await restoredClient.request('GET','/accounts'))[0].balance,'60000');const restoredReport=await restoredClient.request('GET','/transactions?from=1900-01-01&to=2100-12-31&display_currency=KRW');assert.equal(restoredReport.totals[0].expense,'40000');assert.ok(restoredReport.items.some(t=>t.original_amount==='2000'&&t.exchange_rate==='1400'));await stop(restoreApp.child);
 const newPassword=randomBytes(24).toString('base64url');const reset=spawnSync(binary,['reset-password','--data-dir',target,'--username','smoke'],{input:newPassword,encoding:'utf8'});assert.equal(reset.status,0,reset.stderr);const resetApp=await start(target);const resetClient=client(resetApp.url);await resetClient.request('POST','/login',{username:'smoke',password:newPassword});assert.equal((await resetClient.request('GET','/accounts'))[0].balance,'60000');await stop(resetApp.child);
 console.log('PASS packaged executable: deep links, PWA assets, setup, login, native/foreign transactions, restart, backup, CLI restore, session revocation, password recovery');
}finally{for(const child of processes){if(child.exitCode===null)child.kill('SIGKILL');}await rm(root,{recursive:true,force:true});}
