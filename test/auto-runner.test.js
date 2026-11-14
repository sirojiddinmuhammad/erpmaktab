import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunner } from '../auto/runner.js';

const deferred = () => { let resolve; const p = new Promise(r => { resolve = r; }); return { p, resolve }; };
const tick = () => new Promise(r => setImmediate(r));

test('one run per teacher at a time', async () => {
  const r = createRunner({ concurrency: 2, log: () => {} });
  const gate = deferred();
  const done = deferred();
  assert.equal(r.start(1, { items: [1], work: () => gate.p, onDone: done.resolve }), true);
  assert.equal(r.busy(1), true);
  assert.equal(r.start(1, { items: [2], work: async () => 'x', onDone: () => {} }), false);
  gate.resolve({ state: 'done' });
  await done.p;
  assert.equal(r.busy(1), false);
});

test('global concurrency limits how many teachers run at once', async () => {
  const r = createRunner({ concurrency: 2, log: () => {} });
  const gates = [deferred(), deferred(), deferred()];
  const started = [];
  const finished = [deferred(), deferred(), deferred()];
  [0, 1, 2].forEach(k => r.start(10 + k, {
    items: [k], work: () => { started.push(k); return gates[k].p; }, onDone: finished[k].resolve,
  }));
  await tick();
  assert.deepEqual(started, [0, 1]);
  assert.equal(r.busy(12), true); // navbatda ham band
  gates[1].resolve({ state: 'done' });
  await finished[1].p; await tick();
  assert.deepEqual(started, [0, 1, 2]);
  gates[0].resolve({ state: 'done' }); gates[2].resolve({ state: 'done' });
  await Promise.all([finished[0].p, finished[2].p]);
});

test('one failing item does not stop the rest; results keep item order', async () => {
  const r = createRunner({ concurrency: 1, log: () => {} });
  const done = deferred();
  const seen = [];
  r.start(1, {
    items: ['a', 'b', 'c'],
    work: async it => { seen.push(it); if (it === 'b') throw Object.assign(new Error('boom'), { code: 'X' }); return { state: 'done', it }; },
    onDone: done.resolve,
  });
  const results = await done.p;
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(results.length, 3);
  assert.deepEqual(results[0], { state: 'done', it: 'a' });
  assert.equal(results[1].state, 'failed');
  assert.equal(results[1].error.message, 'boom');
  assert.deepEqual(results[2], { state: 'done', it: 'c' });
});

test('onDone is called exactly once even if it throws', async () => {
  const logs = [];
  const r = createRunner({ concurrency: 1, log: (...a) => logs.push(a.join(' ')) });
  let calls = 0;
  r.start(1, { items: [1], work: async () => ({ state: 'done' }), onDone: () => { calls++; throw new Error('tg down'); } });
  await tick(); await tick(); await tick();
  assert.equal(calls, 1);
  assert.equal(r.busy(1), false);
  assert.ok(logs.some(l => /tg down/.test(l)));
});

test('runner reports when a job leaves the queue and each item start/finish', async () => {
  const r = createRunner({ concurrency: 1, log: () => {} });
  const ev = [];
  const done = deferred();
  r.start(1, {
    items: ['a', 'b'], work: async it => ({ state: 'done', it }),
    onRun: () => ev.push('run'),
    onItemStart: i => ev.push(`start ${i}`),
    onItemDone: (i, res) => ev.push(`done ${i} ${res.state}`),
    onDone: done.resolve,
  });
  await done.p;
  assert.deepEqual(ev, ['run', 'start 0', 'done 0 done', 'start 1', 'done 1 done']);
});

test('a throwing progress callback does not break the run', async () => {
  const r = createRunner({ concurrency: 1, log: () => {} });
  const done = deferred();
  r.start(1, { items: ['a'], work: async () => ({ state: 'done' }), onItemStart: () => { throw new Error('tg'); }, onDone: done.resolve });
  const res = await done.p;
  assert.equal(res[0].state, 'done');
});
