import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldReceptionSummary } from '../src/field-reception.js';
import { createAssembler, encodeField } from '../src/protocol.js';

function sample(overrides={}) {
  return {version:1,type:'grid',id:'local-conditions',variable:'rain-category',
    observedAt:'2026-10-17T15:00:00.000Z',expiresAt:'2026-10-17T17:00:00.000Z',
    source:{name:'Meteorological service',url:'https://example.org/observations'},
    bounds:[130,30,134,34],cols:2,rows:2,values:[0,1,2,255],context:'live',...overrides};
}

test('complete reception diagnostics describe real assembled fields across locations and contexts',async()=>{
  for(const field of [sample(),sample({id:'Southern region',bounds:[18,-34,22,-30],context:'replay',cols:4,rows:1,values:[3,2,1,0]})]) {
    const receiver=createAssembler();
    const {frames}=await encodeField(field);
    let complete;
    for(const frame of frames)complete=await receiver.accept(frame);
    assert.equal(complete.state,'complete');
    const summary=fieldReceptionSummary({field:complete.field,receivedAt:'2026-10-17T10:02:03-05:00'});
    assert.equal(summary.observedAt,field.observedAt);
    assert.equal(summary.receivedAt,'2026-10-17T15:02:03.000Z');
    assert.equal(summary.id,field.id);
    assert.equal(summary.context,field.context);
    assert.equal(summary.cols*summary.rows,field.values.length);
    assert.ok(summary.label.includes(`Observación ${field.observedAt}.`));
    assert.ok(summary.label.includes(`Recibido ${summary.receivedAt}.`));
  }
});

test('diagnostics reject partial or invalid fields and missing reception dates',()=>{
  assert.throws(()=>fieldReceptionSummary({state:'partial',received:1,total:2}));
  assert.throws(()=>fieldReceptionSummary({field:sample(),receivedAt:'invalid'}));
  assert.throws(()=>fieldReceptionSummary({field:sample()}));
  assert.throws(()=>fieldReceptionSummary({field:sample({values:[0]}),receivedAt:'2026-10-17T15:02:03Z'}));
  const summary=fieldReceptionSummary({field:sample({id:'<img src=x onerror=alert(1)>'}),receivedAt:'2026-10-17T15:02:03Z'});
  assert.equal(summary.id,'<img src=x onerror=alert(1)>');
  assert.ok(summary.label.includes(summary.id),'Names remain plain text for the textContent renderer.');
});
