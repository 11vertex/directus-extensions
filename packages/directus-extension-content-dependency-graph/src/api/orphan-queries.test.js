import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textCastType, whereColumnsMatch } from "./orphan-queries.js";

const knexFor = (client) => ({ client: { config: { client } } });

function recorder() {
  const calls = [];
  return { calls, whereRaw: (sql, bindings) => { calls.push([sql, bindings]); } };
}

describe("textCastType", () => {
  it("picks a text type per vendor", () => {
    assert.equal(textCastType(knexFor("pg")), "TEXT");
    assert.equal(textCastType(knexFor("sqlite3")), "TEXT");
    assert.equal(textCastType(knexFor("mysql2")), "CHAR");
    assert.equal(textCastType(knexFor("mssql")), "NVARCHAR(255)");
    assert.equal(textCastType(knexFor("oracledb")), "VARCHAR2(255)");
    assert.equal(textCastType(undefined), "TEXT");
  });
});

describe("whereColumnsMatch", () => {
  it("compares same-typed columns directly", () => {
    const builder = recorder();
    whereColumnsMatch(knexFor("pg"), builder, "r0.author", "integer", "t.id", "integer");
    assert.deepEqual(builder.calls, [["?? = ??", ["r0.author", "t.id"]]]);
  });

  it("casts mismatched columns to text", () => {
    const builder = recorder();
    whereColumnsMatch(knexFor("mysql"), builder, "r0.item", "m2a-key", "t.id", "integer");
    assert.deepEqual(builder.calls, [["CAST(?? AS CHAR) = CAST(?? AS CHAR)", ["r0.item", "t.id"]]]);
  });
});
