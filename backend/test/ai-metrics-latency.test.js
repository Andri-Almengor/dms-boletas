import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aiMetricsSnapshot, recordAiMetrics, resetAiMetricsForTests,
} from '../src/ai/agent.metrics.js';

test('assistant latency p50/p95 surfaces long-tail freezes without retaining messages', () => {
  resetAiMetricsForTests();
  try {
    for (let i=0; i<18; i++) recordAiMetrics({durationMs:120,toolCalls:1});
    for (let i=0; i<2; i++) recordAiMetrics({durationMs:1500,error:true});
    const metric=aiMetricsSnapshot();
    assert.equal(metric.requests,20);
    assert.equal(metric.errors,2);
    assert.deepEqual(metric.recentLatency,{
      count:20,windowSize:128,p50Ms:120,p95Ms:1500,maxMs:1500,
    });
    assert.equal('message' in metric,false);
    assert.equal('sessionToken' in metric,false);
    assert.equal('payload' in metric,false);
  } finally {
    resetAiMetricsForTests();
  }
});

test('assistant latency sample window remains bounded and resets safely', () => {
  resetAiMetricsForTests();
  try {
    recordAiMetrics({durationMs:-1});
    recordAiMetrics({durationMs:NaN});
    assert.equal(aiMetricsSnapshot().recentLatency.count,0);
    for (let i=0; i<140; i++) recordAiMetrics({durationMs:i});
    const result=aiMetricsSnapshot();
    assert.equal(result.requests,142);
    assert.deepEqual(result.recentLatency,{
      count:128,windowSize:128,p50Ms:75,p95Ms:133,maxMs:139,
    });
    resetAiMetricsForTests();
    assert.equal(aiMetricsSnapshot().recentLatency.count,0);
    assert.equal(aiMetricsSnapshot().recentLatency.p95Ms,0);
  } finally {
    resetAiMetricsForTests();
  }
});
