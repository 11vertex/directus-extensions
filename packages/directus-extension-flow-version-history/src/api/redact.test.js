import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactValue, stripRelationalFields } from "./redact.js";

describe("redactValue", () => {
  it("redacts sensitive keys and discord webhook urls", () => {
    const redacted = redactValue({
      name: "Send Discord",
      options: {
        url: "https://discord.com/api/webhooks/123/abc",
        authorization: "Bearer secret",
        method: "POST"
      },
      password: "hunter2"
    });
    assert.equal(redacted.options.url, "[REDACTED]");
    assert.equal(redacted.options.authorization, "[REDACTED]");
    assert.equal(redacted.password, "[REDACTED]");
    assert.equal(redacted.options.method, "POST");
    assert.equal(redacted.name, "Send Discord");
  });
});

describe("stripRelationalFields", () => {
  it("removes flow graph edges from comparison payloads", () => {
    assert.deepEqual(
      stripRelationalFields(
        {
          name: "Op",
          flow: "flow-1",
          resolve: "op-2",
          reject: null,
          options: { a: 1 }
        },
        "directus_operations"
      ),
      { name: "Op", options: { a: 1 } }
    );
  });
});
