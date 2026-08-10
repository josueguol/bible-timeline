// Runnable check: node --experimental-strip-types web/src/ui/float-cascade.selfcheck.ts
import assert from "node:assert/strict";
import { cascadeDepths } from "./float-cascade.ts";

// 3 cards on the same pixel + lane → depths 0,1,2
assert.deepEqual(
  cascadeDepths([{ lane: 0, screenX: 500 }, { lane: 0, screenX: 500 }, { lane: 0, screenX: 500 }], 250),
  [0, 1, 2],
);

// 2 cards farther apart than cardW → no overlap, both depth 0
assert.deepEqual(
  cascadeDepths([{ lane: 0, screenX: 100 }, { lane: 0, screenX: 400 }], 250),
  [0, 0],
);

// Same screenX but different lanes → never grouped
assert.deepEqual(
  cascadeDepths([{ lane: 0, screenX: 500 }, { lane: 1, screenX: 500 }], 250),
  [0, 0],
);

// Depths are returned in input order, not sorted order
assert.deepEqual(
  cascadeDepths([{ lane: 0, screenX: 520 }, { lane: 0, screenX: 500 }], 250),
  [1, 0],
);

console.log("float-cascade self-check OK");
