import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getContentFields, getFileFields, getFileReferenceSources } from "./reference-sources.js";

const field = (name, type = "string", extra = {}) => ({ field: name, type, special: [], alias: false, ...extra });

const schema = {
  collections: {
    directus_files: { primary: "id", fields: { id: field("id", "uuid"), filesize: field("filesize", "bigInteger"), type: field("type"), filename_download: field("filename_download") } },
    directus_users: { primary: "id", fields: { id: field("id", "uuid"), avatar: field("avatar", "uuid"), token: field("token", "string", { special: ["conceal"] }) } },
    directus_settings: { primary: "id", fields: { id: field("id", "integer"), project_logo: field("project_logo", "uuid") } },
    articles: { primary: "id", fields: { id: field("id", "integer"), cover: field("cover", "uuid"), body: field("body", "text"), blocks: field("blocks", "json"), gallery: field("gallery", "alias", { alias: true }), views: field("views", "integer") } },
    articles_files: { primary: "id", fields: { id: field("id", "integer"), articles_id: field("articles_id", "integer"), directus_files_id: field("directus_files_id", "uuid") } },
    pages_blocks: { primary: "id", fields: { id: field("id", "integer"), item: field("item"), collection: field("collection") } }
  },
  relations: [
    { collection: "directus_users", field: "avatar", related_collection: "directus_files", meta: null },
    { collection: "directus_settings", field: "project_logo", related_collection: "directus_files", meta: null },
    { collection: "articles", field: "cover", related_collection: "directus_files", meta: null },
    { collection: "articles_files", field: "directus_files_id", related_collection: "directus_files", meta: { junction_field: "articles_id" } },
    { collection: "articles_files", field: "articles_id", related_collection: "articles", meta: { one_field: "gallery", junction_field: "directus_files_id" } },
    { collection: "pages_blocks", field: "item", related_collection: null, meta: { one_allowed_collections: ["directus_files", "headings"], one_collection_field: "collection" } },
    { collection: "directus_files", field: "folder", related_collection: "directus_folders", meta: null }
  ]
};

describe("getFileReferenceSources", () => {
  const sources = getFileReferenceSources(schema);
  const byId = Object.fromEntries(sources.map((source) => [source.id, source]));

  it("finds system and user M2O file fields from relations", () => {
    assert.equal(byId["directus_users.avatar"].kind, "m2o");
    assert.equal(byId["directus_users.avatar"].system, true);
    assert.ok(byId["directus_settings.project_logo"]);
    assert.equal(byId["articles.cover"].label, "articles.cover");
    assert.equal(byId["articles.cover"].usageField, "cover");
  });

  it("labels junction collections with their parent field", () => {
    const junction = byId["articles_files.directus_files_id"];
    assert.equal(junction.kind, "junction");
    assert.equal(junction.usageCollection, "articles");
    assert.equal(junction.usageField, "gallery");
    assert.equal(junction.label, "articles.gallery (via articles_files)");
  });

  it("includes M2A junctions that allow files", () => {
    assert.equal(byId["pages_blocks.item"].kind, "m2a");
    assert.equal(byId["pages_blocks.item"].collectionField, "collection");
  });

  it("ignores relations to other collections", () => {
    assert.equal(byId["directus_files.folder"], undefined);
    assert.equal(byId["articles_files.articles_id"], undefined);
    assert.equal(sources.length, 5);
  });
});

describe("getContentFields", () => {
  it("returns text and JSON fields of user collections only", () => {
    const ids = getContentFields(schema, getFileReferenceSources(schema)).map((entry) => entry.id).sort();
    assert.deepEqual(ids, ["articles.blocks", "articles.body"]);
  });
});

describe("getFileFields", () => {
  it("keeps only existing columns and reports no checksum", () => {
    const { fields, checksumField } = getFileFields(schema);
    assert.deepEqual(fields, ["id", "filename_download", "type", "filesize"]);
    assert.equal(checksumField, null);
  });

  it("detects a checksum column when present", () => {
    const withHash = { collections: { directus_files: { fields: { id: {}, md5: {} } } } };
    assert.equal(getFileFields(withHash).checksumField, "md5");
  });
});
