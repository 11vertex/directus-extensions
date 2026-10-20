import { createClient, waitFor } from "./client.mjs";

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

export const SEED = {
  editorEmail: "editor@example.com",
  editorPassword: "editor-password-123",
  discordWebhook: "https://discord.com/api/webhooks/123456/abcDEF_ghi",
  slackWebhook: "https://hooks.slack.com/services/T000/B000/XXXX",
  teamsWebhook: "https://prod-00.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=test"
};

const id = { field: "id", type: "integer", meta: { hidden: true }, schema: { is_primary_key: true, has_auto_increment: true } };
const string = (field) => ({ field, type: "string", meta: { interface: "input" }, schema: {} });
const m2o = (field, type = "integer", special = "m2o") => ({
  field,
  type,
  meta: { interface: special === "file" ? "file-image" : "select-dropdown-m2o", special: [special] },
  schema: {}
});

/**
 * Builds a small, deliberately imperfect project:
 * - authors <- articles.author (SET NULL), articles <- comments.article (CASCADE), articles.cover -> files
 * - "Bob" is an author nobody references (orphan)
 * - files: one used cover, one unused image, two identical uploads (duplicates)
 * - Editor role: read + wildcard update + unfiltered delete on articles, read on comments (auditor findings)
 * - Public policy can read every author (auditor finding)
 * - Flows: one that sends Discord -> Slack -> Teams, one that always fails
 */
export async function seed(baseUrl, adminToken) {
  const admin = createClient(baseUrl, adminToken);
  const ok = (method, path, body) => admin.ok(method, path, body);

  await ok("POST", "/collections", { collection: "authors", meta: { display_template: "{{name}}" }, schema: {}, fields: [id, string("name")] });
  await ok("POST", "/collections", {
    collection: "articles",
    meta: { display_template: "{{title}}" },
    schema: {},
    fields: [id, string("title"), string("status"), m2o("author"), m2o("cover", "uuid", "file")]
  });
  await ok("POST", "/collections", { collection: "comments", meta: {}, schema: {}, fields: [id, string("body"), m2o("article")] });

  await ok("POST", "/relations", { collection: "articles", field: "author", related_collection: "authors", schema: { on_delete: "SET NULL" } });
  await ok("POST", "/relations", { collection: "articles", field: "cover", related_collection: "directus_files", schema: { on_delete: "SET NULL" } });
  await ok("POST", "/relations", { collection: "comments", field: "article", related_collection: "articles", schema: { on_delete: "CASCADE" } });

  const upload = async (name, type, content) => {
    const form = new FormData();
    form.append("title", name);
    form.append("file", new Blob([content], { type }), name);
    return ok("POST", "/files", form);
  };
  const cover = await upload("cover.png", "image/png", PNG);
  const unused = await upload("unused.png", "image/png", PNG);
  const duplicateA = await upload("report.txt", "text/plain", "quarterly report");
  const duplicateB = await upload("report.txt", "text/plain", "quarterly report");

  const alice = await ok("POST", "/items/authors", { name: "Alice" });
  const bob = await ok("POST", "/items/authors", { name: "Bob" });
  const published = await ok("POST", "/items/articles", { title: "Published article", status: "published", author: alice.id, cover: cover.id });
  const draft = await ok("POST", "/items/articles", { title: "Draft article", status: "draft", author: alice.id });
  await ok("POST", "/items/comments", { body: "First!", article: published.id });
  await ok("POST", "/items/comments", { body: "Nice post", article: published.id });

  // Access control
  const policy = await ok("POST", "/policies", { name: "Editors", icon: "badge", app_access: true, admin_access: false, enforce_tfa: false });
  const role = await ok("POST", "/roles", { name: "Editor", icon: "edit" });
  await ok("POST", "/access", { role: role.id, policy: policy.id });
  await ok("POST", "/permissions", [
    { policy: policy.id, collection: "articles", action: "read", fields: ["*"], permissions: null },
    { policy: policy.id, collection: "articles", action: "update", fields: ["*"], permissions: {} },
    { policy: policy.id, collection: "articles", action: "delete", fields: ["*"], permissions: {} },
    { policy: policy.id, collection: "comments", action: "read", fields: ["*"], permissions: {} }
  ]);
  // Item filters and field lists ("custom permission rules") need a Directus licence. On an unlicensed
  // instance the API refuses them and Directus ignores existing ones, so every rule here uses all
  // fields and no filter. Partial access is covered by the extensions' unit tests.

  const editor = await ok("POST", "/users", { email: SEED.editorEmail, password: SEED.editorPassword, role: role.id, first_name: "Erin", last_name: "Editor" });

  const publicAccess = await ok("GET", "/access?filter[role][_null]=true&filter[user][_null]=true&fields=policy");
  const publicPolicyId = publicAccess[0].policy;
  await ok("POST", "/permissions", { policy: publicPolicyId, collection: "authors", action: "read", fields: ["*"], permissions: {} });

  // Flows
  const notify = await ok("POST", "/flows", {
    name: "Order notify",
    status: "active",
    trigger: "webhook",
    accountability: "all",
    options: { method: "GET", async: false }
  });
  const teams = await ok("POST", "/operations", {
    flow: notify.id, name: "Teams", key: "teams_msg", type: "teams", position_x: 55, position_y: 1,
    options: { webhookUrl: SEED.teamsWebhook, title: "New order", text: "Order {{$trigger.query.order}} on Teams" }
  });
  const slack = await ok("POST", "/operations", {
    flow: notify.id, name: "Slack", key: "slack_msg", type: "slack", position_x: 37, position_y: 1, resolve: teams.id,
    options: { integrationMethod: "webhook", webhookUrl: SEED.slackWebhook, text: "Order {{$trigger.query.order}} on Slack" }
  });
  const discord = await ok("POST", "/operations", {
    flow: notify.id, name: "Discord", key: "discord_msg", type: "discord", position_x: 19, position_y: 1, resolve: slack.id,
    options: { integrationMethod: "webhook", channelId: SEED.discordWebhook, messageType: "simple", message: "Order {{$trigger.query.order}} placed" }
  });
  await ok("PATCH", `/flows/${notify.id}`, { operation: discord.id });

  // A definition edit for Flow Version History
  await ok("PATCH", `/flows/${notify.id}`, { name: "Order notifications" });
  await ok("PATCH", `/operations/${slack.id}`, {
    options: { integrationMethod: "webhook", webhookUrl: SEED.slackWebhook, text: "Order {{$trigger.query.order}} on Slack!" }
  });

  const broken = await ok("POST", "/flows", {
    name: "Broken alert",
    status: "active",
    trigger: "webhook",
    accountability: "all",
    options: { method: "GET", async: false }
  });
  const badStep = await ok("POST", "/operations", {
    flow: broken.id, name: "Bad Slack", key: "bad_slack", type: "slack", position_x: 19, position_y: 1,
    options: { integrationMethod: "webhook", webhookUrl: "https://example.com/not-slack", text: "never sent" }
  });
  await ok("PATCH", `/flows/${broken.id}`, { operation: badStep.id });

  // Run each flow twice so there is history to list and compare.
  const trigger = async (flowId, order) => {
    const result = await waitFor(
      async () => {
        const response = await admin.get(`/flows/trigger/${flowId}?order=${order}`);
        return response.status === 404 ? null : response;
      },
      { message: `flow ${flowId} to be registered` }
    );
    return result.status;
  };
  await trigger(notify.id, 41);
  await trigger(notify.id, 42);
  await trigger(broken.id, 1);
  await trigger(broken.id, 2);

  return {
    collections: ["authors", "articles", "comments"],
    authors: { alice: alice.id, bob: bob.id },
    articles: { published: published.id, draft: draft.id },
    files: { cover: cover.id, unused: unused.id, duplicateA: duplicateA.id, duplicateB: duplicateB.id },
    roles: { editor: role.id },
    policies: { editors: policy.id, public: publicPolicyId },
    users: { editor: editor.id },
    flows: { notify: notify.id, broken: broken.id },
    operations: { discord: discord.id, slack: slack.id, teams: teams.id, badStep: badStep.id }
  };
}
