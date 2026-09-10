import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { BillingService } from '../src/service.js';
import { tokenCost } from '../src/config.js';

const setup=()=>{const db=openDatabase();const service=new BillingService(db,'secret');service.ensureTenant('a');service.ensureTenant('b');return{db,service};};

test('retries create exactly one usage event',()=>{const{db,service}=setup();const input={kind:'api_calls',quantity:2};assert.equal(service.record('a','same',input).duplicate,false);assert.equal(service.record('a','same',input).duplicate,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM usage_events').get().n,1);});
test('quota excess returns honest 429',()=>{const{service}=setup();assert.throws(()=>service.record('a','large',{kind:'api_calls',quantity:1001}),e=>e.status===429&&/quota exceeded/.test(e.message));});
test('inactive subscription returns 402',()=>{const{db,service}=setup();db.prepare(`UPDATE subscriptions SET status='past_due' WHERE tenant_id='a'`).run();assert.throws(()=>service.record('a','x',{kind:'api_calls',quantity:1}),e=>e.status===402);});
test('integer cost math distinguishes cached, output, and reasoning tokens',()=>{assert.equal(tokenCost({input:100,cached_input:100,output:100,reasoning:100}),45500);});
test('usage rollup is isolated by tenant',()=>{const{service}=setup();service.record('a','a1',{kind:'api_calls',quantity:9});service.record('b','b1',{kind:'api_calls',quantity:3});assert.equal(service.rollup('a').used.api_calls,9);assert.equal(service.rollup('b').used.api_calls,3);});
test('signed checkout webhook upgrades tenant and replay is ignored',()=>{const{service}=setup();const checkout=service.checkout('a');const raw=JSON.stringify({id:'evt_1',type:'checkout.session.completed',data:{object:{id:checkout.id,customer:'cus_test',subscription:'sub_test',metadata:{tenant_id:'a'}}}});const first=service.webhook(raw,service.sign(raw));assert.equal(first.subscription.plan,'pro');assert.equal(service.webhook(raw,service.sign(raw)).duplicate,true);});
test('forged webhook is rejected',()=>{const{service}=setup();assert.throws(()=>service.webhook('{}','forged'),e=>e.status===400);});
test('reconciliation job survives storage and alerts on mismatch',()=>{const{service}=setup();const job=service.queueReconciliation('a','reconcile-1');const result=service.runReconciliation('a',job.id,{plan:'pro'});assert.equal(result.state,'completed');assert.match(result.alert,/plan mismatch/);assert.equal(service.queueReconciliation('a','reconcile-1').id,job.id);});
