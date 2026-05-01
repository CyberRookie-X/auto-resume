import test from "node:test"
import assert from "node:assert/strict"

import { createOpenCodeAdapter, createRecoveryEngine } from "../src/index.js"

test("public entrypoint exports the core and adapter", () => {
  assert.equal(typeof createRecoveryEngine, "function")
  assert.equal(typeof createOpenCodeAdapter, "function")
})
