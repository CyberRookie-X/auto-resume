import test from "node:test"
import assert from "node:assert/strict"

import { createDefaultConfig } from "../src/index.js"

test("exports a default config factory", () => {
  const config = createDefaultConfig()
  assert.equal(typeof config, "object")
  assert.ok(Array.isArray(config.rules))
})
