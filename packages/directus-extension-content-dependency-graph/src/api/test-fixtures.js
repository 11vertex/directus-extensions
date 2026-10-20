// Minimal SchemaOverview used by the unit tests (shape of `getSchema()` in @directus/api).

const field = (name, type, extra = {}) => ({ field: name, type, nullable: true, alias: false, ...extra });

const collection = (name, fields, extra = {}) => ({
  collection: name,
  primary: "id",
  singleton: false,
  note: null,
  fields: Object.fromEntries(fields.map((entry) => [entry.field, entry])),
  ...extra
});

const fk = (table, column, target, onDelete = "NO ACTION") => ({
  table,
  column,
  foreign_key_table: target,
  foreign_key_column: "id",
  constraint_name: `${table}_${column}_foreign`,
  on_update: "NO ACTION",
  on_delete: onDelete
});

const meta = (many_collection, many_field, one_collection, extra = {}) => ({
  many_collection,
  many_field,
  one_collection,
  one_field: null,
  one_collection_field: null,
  one_allowed_collections: null,
  junction_field: null,
  sort_field: null,
  one_deselect_action: "nullify",
  ...extra
});

export function createSchema() {
  return {
    collections: {
      authors: collection("authors", [
        field("id", "integer", { nullable: false }),
        field("name", "string"),
        field("favorite_article", "integer"),
        field("articles", "alias", { alias: true })
      ]),
      articles: collection("articles", [
        field("id", "integer", { nullable: false }),
        field("title", "string"),
        field("author", "integer"),
        field("editor", "uuid", { nullable: false }),
        field("parent", "integer"),
        field("tags", "alias", { alias: true })
      ]),
      tags: collection("tags", [field("id", "integer"), field("name", "string")]),
      articles_tags: collection("articles_tags", [field("id", "integer"), field("articles_id", "integer"), field("tags_id", "integer")]),
      pages: collection("pages", [field("id", "integer"), field("title", "string"), field("blocks", "alias", { alias: true })]),
      pages_blocks: collection("pages_blocks", [
        field("id", "integer"),
        field("pages_id", "integer"),
        field("item", "string"),
        field("collection", "string")
      ]),
      text_blocks: collection("text_blocks", [field("id", "integer"), field("body", "text")]),
      image_blocks: collection("image_blocks", [field("id", "integer")]),
      comments: collection("comments", [field("id", "integer"), field("article", "integer")]),
      lonely: collection("lonely", [field("id", "integer")]),
      directus_users: collection("directus_users", [field("id", "uuid"), field("email", "string"), field("password", "hash")])
    },
    relations: [
      {
        collection: "articles",
        field: "author",
        related_collection: "authors",
        schema: fk("articles", "author", "authors", "SET NULL"),
        meta: meta("articles", "author", "authors", { one_field: "articles" })
      },
      {
        collection: "articles",
        field: "editor",
        related_collection: "directus_users",
        schema: fk("articles", "editor", "directus_users", "SET NULL"),
        meta: null
      },
      {
        collection: "articles",
        field: "parent",
        related_collection: "articles",
        schema: fk("articles", "parent", "articles", "SET NULL"),
        meta: meta("articles", "parent", "articles")
      },
      {
        collection: "authors",
        field: "favorite_article",
        related_collection: "articles",
        schema: fk("authors", "favorite_article", "articles", "RESTRICT"),
        meta: meta("authors", "favorite_article", "articles")
      },
      {
        collection: "articles_tags",
        field: "articles_id",
        related_collection: "articles",
        schema: fk("articles_tags", "articles_id", "articles", "CASCADE"),
        meta: meta("articles_tags", "articles_id", "articles", { one_field: "tags", junction_field: "tags_id", one_deselect_action: "delete" })
      },
      {
        collection: "articles_tags",
        field: "tags_id",
        related_collection: "tags",
        schema: fk("articles_tags", "tags_id", "tags", "CASCADE"),
        meta: meta("articles_tags", "tags_id", "tags", { junction_field: "articles_id" })
      },
      {
        collection: "pages_blocks",
        field: "pages_id",
        related_collection: "pages",
        schema: fk("pages_blocks", "pages_id", "pages", "CASCADE"),
        meta: meta("pages_blocks", "pages_id", "pages", { one_field: "blocks", junction_field: "item" })
      },
      {
        collection: "pages_blocks",
        field: "item",
        related_collection: null,
        schema: null,
        meta: meta("pages_blocks", "item", null, {
          one_allowed_collections: ["text_blocks", "image_blocks"],
          one_collection_field: "collection",
          junction_field: "pages_id"
        })
      },
      {
        collection: "comments",
        field: "article",
        related_collection: "articles",
        schema: null,
        meta: meta("comments", "article", "articles")
      }
    ]
  };
}
