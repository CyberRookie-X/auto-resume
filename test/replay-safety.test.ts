import test from "node:test"
import assert from "node:assert/strict"

import { classifyReplaySafety, extractReplayRequest } from "../src/replay.js"

test("read-only tool chains are replay-safe", () => {
  const safety = classifyReplaySafety([
    {
      info: { role: "user", id: "msg_u1" },
      parts: [{ type: "text", text: "search the docs" }],
    },
    {
      info: { role: "assistant", id: "msg_a1" },
      parts: [
        { type: "tool", tool: "read", state: { status: "completed" } },
        { type: "tool", tool: "search", state: { status: "completed" } },
      ],
    },
    {
      info: { role: "user", id: "msg_u2" },
      parts: [{ type: "text", text: "thanks" }],
    },
  ])

  assert.equal(safety, "safe")
})

test("benign assistant parts do not block read-only replay safety", () => {
  const safety = classifyReplaySafety([
    {
      info: { role: "user", id: "msg_u1" },
      parts: [{ type: "text", text: "search the docs" }],
    },
    {
      info: { role: "assistant", id: "msg_a1" },
      parts: [
        { type: "reasoning", text: "thinking" },
        { type: "step-finish", reason: "done" },
        { type: "tool", tool: "read", state: { status: "completed" } },
        { type: "tool", tool: "search", state: { status: "completed" } },
      ],
    },
  ])

  assert.equal(safety, "safe")
})

test("write, shell, and unknown tool chains are unsafe", () => {
  assert.equal(
    classifyReplaySafety([
      {
        info: { role: "assistant", id: "msg_a2" },
        parts: [{ type: "tool", tool: "write", state: { status: "completed" } }],
      },
      {
        info: { role: "user", id: "msg_u3" },
        parts: [{ type: "text", text: "continue" }],
      },
    ]),
    "unsafe",
  )

  assert.equal(
    classifyReplaySafety([
      {
        info: { role: "assistant", id: "msg_a3" },
        parts: [{ type: "tool", tool: "shell", state: { status: "completed" } }],
      },
      {
        info: { role: "user", id: "msg_u4" },
        parts: [{ type: "text", text: "continue" }],
      },
    ]),
    "unsafe",
  )

  assert.equal(
    classifyReplaySafety([
      {
        info: { role: "assistant", id: "msg_a4" },
        parts: [{ type: "tool", tool: "rename", state: { status: "completed" } }],
      },
    ]),
    "unsafe",
  )
})

test("extractReplayRequest returns a replay body for a text-only latest user message", () => {
  const request = extractReplayRequest([
    {
      info: { role: "user", id: "msg_u5" },
      parts: [{ type: "text", text: "old request" }],
    },
    {
      info: { role: "assistant", id: "msg_a5" },
      parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
    },
    {
      info: { role: "user", id: "msg_u6", agent: "agent-1", model: "model-1" },
      parts: [
        { type: "text", text: "search the docs" },
        { type: "text", text: "and summarize" },
      ],
    },
    {
      info: { role: "assistant", id: "msg_a6" },
      parts: [{ type: "tool", tool: "search", state: { status: "completed" } }],
    },
  ])

  assert.deepEqual(request, {
    parts: [
      { type: "text", text: "search the docs" },
      { type: "text", text: "and summarize" },
    ],
    agent: "agent-1",
    model: "model-1",
  })
})

test("extractReplayRequest returns null for mixed or non-text user parts", () => {
  assert.equal(
    extractReplayRequest([
      {
        info: { role: "user", id: "msg_u7" },
        parts: [{ type: "text", text: "old request" }],
      },
      {
        info: { role: "assistant", id: "msg_a7" },
        parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
      },
      {
        info: { role: "user", id: "msg_u8" },
        parts: [
          { type: "text", text: "search the docs" },
          { type: "tool", tool: "read", state: { status: "completed" } },
        ],
      },
      {
        info: { role: "assistant", id: "msg_a8" },
        parts: [{ type: "tool", tool: "search", state: { status: "completed" } }],
      },
    ]),
    null,
  )

  assert.equal(
    extractReplayRequest([
      {
        info: { role: "user", id: "msg_u9" },
        parts: [{ type: "text", text: "old request" }],
      },
      {
        info: { role: "assistant", id: "msg_a9" },
        parts: [{ type: "tool", tool: "read", state: { status: "completed" } }],
      },
      {
        info: { role: "user", id: "msg_u10" },
        parts: [{ type: "reasoning", text: "thinking" }],
      },
      {
        info: { role: "assistant", id: "msg_a10" },
        parts: [{ type: "tool", tool: "search", state: { status: "completed" } }],
      },
    ]),
    null,
  )
})
