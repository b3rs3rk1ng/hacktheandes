import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATION_KEY, normalizeLocation, loadLocation, saveLocation, locateDevice } from '../src/location.js';

const memory = () => {
  const entries = new Map();
  return { getItem:key=>entries.get(key)??null, setItem:(key,value)=>entries.set(key,String(value)) };
};
const fallback = { longitude:85.324, latitude:27.7172, name:'Kathmandu' };

test('manual coordinates and stored selection are independent of countries, sources and network services', () => {
  const storage = memory();
  for (const point of [fallback, {longitude:139.6917,latitude:35.6895,name:'Tokyo'}, {longitude:18.4241,latitude:-33.9249,name:'Cape Town'}, {longitude:180,latitude:90,name:'North Pole'}, {longitude:-180,latitude:-90,name:'South Pole'}]) {
    assert.deepEqual(saveLocation(storage,point),point);
    assert.deepEqual(loadLocation(storage,fallback),point);
  }
  const original={longitude:0,latitude:0,name:'  Prime meridian  ',accuracy:0,sourceUrl:'https://ignored.example'};
  assert.deepEqual(normalizeLocation(original),{longitude:0,latitude:0,name:'Prime meridian',accuracy:0});
  assert.equal(original.name,'  Prime meridian  ');
  assert.equal(normalizeLocation({longitude:0,latitude:0,name:'  '}).name,'Punto elegido');
  assert.equal(normalizeLocation({...fallback,name:'x'.repeat(200)}).name.length,100);
});

test('invalid or unavailable saved state falls back without deleting valid manual options', () => {
  const storage=memory();
  assert.deepEqual(loadLocation(storage,fallback),fallback);
  for(const raw of ['broken','null','[]','{}','{"longitude":181,"latitude":0}','{"longitude":0,"latitude":91}','{"longitude":"0","latitude":0}','{"longitude":0,"latitude":0,"accuracy":-1}']) {
    storage.setItem(LOCATION_KEY,raw);
    assert.deepEqual(loadLocation(storage,fallback),fallback);
  }
  assert.deepEqual(loadLocation({getItem(){throw new Error('disabled');}},fallback),fallback);
  assert.deepEqual(loadLocation(null,fallback),fallback);
  assert.throws(()=>saveLocation({setItem(){throw new Error('quota');}},fallback),/quota/);
  for(const invalid of [{longitude:Infinity,latitude:0},{longitude:0,latitude:NaN},{longitude:0,latitude:0,accuracy:Infinity},{longitude:0,latitude:0,accuracy:null}]) assert.throws(()=>normalizeLocation(invalid));
});

test('device geolocation works through the supplied OS API without fetching or reverse-geocoding', async () => {
  const originalFetch=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async()=>{requests++;throw new Error('offline');};
  try {
    const geolocation={getCurrentPosition(success,_failure,options){
      assert.deepEqual(options,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
      success({coords:{longitude:139.6917,latitude:35.6895,accuracy:12}});
    }};
    const position=await locateDevice(geolocation);
    assert.deepEqual(position,{longitude:139.6917,latitude:35.6895,accuracy:12,name:'Mi ubicación GPS'});
    const storage=memory();saveLocation(storage,position);
    assert.deepEqual(loadLocation(storage,fallback),position);
    assert.equal(requests,0);
  } finally {globalThis.fetch=originalFetch;}
});

test('GPS unavailable, permission, acquisition and timeout failures explain the manual fallback', async () => {
  await assert.rejects(locateDevice(null),/Elige tu lugar en el mapa/);
  await assert.rejects(locateDevice({}),/Elige tu lugar en el mapa/);
  for(const code of [1,2,3]) {
    const geolocation={getCurrentPosition(_success,failure){failure({code});}};
    await assert.rejects(locateDevice(geolocation),code===1?/sin permiso/:code===3?/tardó demasiado/:/No se consiguió posición/);
  }
  await assert.rejects(locateDevice({getCurrentPosition(){const error=new Error('blocked');error.name='SecurityError';throw error;}}),/sin permiso/);
  await assert.rejects(locateDevice({getCurrentPosition(success){success({coords:{longitude:500,latitude:0,accuracy:10}});}}),/Ubicación inválida/);
  await assert.rejects(locateDevice({getCurrentPosition(success){success(null);}}),/Ubicación inválida/);
  await assert.rejects(locateDevice({getCurrentPosition(){}},{timeout:2}),/tardó demasiado/);
  await assert.rejects(locateDevice({getCurrentPosition(){assert.fail('invalid timeout must not call device');}},{timeout:Infinity}),/espera GPS inválido/);
});
