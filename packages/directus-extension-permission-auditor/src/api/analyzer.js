const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const WRITE_ACTIONS = ["create", "update", "delete"];

// System collections where write access effectively grants privilege escalation or instance control.
const PRIVILEGED_COLLECTIONS = new Set([
  "directus_roles",
  "directus_policies",
  "directus_permissions",
  "directus_access",
  "directus_settings",
  "directus_users",
  "directus_flows",
  "directus_operations",
  "directus_extensions",
  "directus_collections",
  "directus_fields",
  "directus_relations",
  "directus_webhooks"
]);

// System collections whose contents should never be broadly readable.
const SENSITIVE_READ_COLLECTIONS = new Set([
  "directus_users",
  "directus_sessions",
  "directus_access",
  "directus_policies",
  "directus_permissions",
  "directus_settings",
  "directus_shares",
  "directus_activity",
  "directus_revisions"
]);

const SENSITIVE_FIELD_PATTERN = /password|passwd|secret|token|api[_-]?key|private[_-]?key|credential/i;

function isEmptyFilter(value) {
  return value === null || value === undefined || (typeof value === "object" && Object.keys(value).length === 0);
}

function hasWildcard(fields) {
  return Array.isArray(fields) ? fields.includes("*") : fields === "*";
}

function toFieldList(fields) {
  if (Array.isArray(fields)) return fields;
  if (typeof fields === "string") return fields.split(",").map((field) => field.trim()).filter(Boolean);
  return [];
}

function describePolicy(policy) {
  return policy.name ? `"${policy.name}"` : "without a name";
}

// "directus_users" -> "Users (system)", "blog_posts" stays as-is.
function describeCollection(collection) {
  if (typeof collection !== "string" || !collection.startsWith("directus_")) return String(collection);
  const name = collection.slice("directus_".length).replaceAll("_", " ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} (system)`;
}

function describeAssignments(assignments, roleNames) {
  const roles = assignments
    .filter((entry) => entry.role)
    .map((entry) => `${roleNames.get(String(entry.role)) ?? "unnamed"} role`);
  const users = assignments.filter((entry) => entry.user).length;
  const parts = [...roles];
  if (users > 0) parts.push(`${users} ${users === 1 ? "user" : "users"}`);
  if (assignments.some((entry) => !entry.role && !entry.user)) parts.push("public visitors");
  return parts.length > 0 ? parts.join(", ") : "nobody yet";
}

const VERBS = { create: "add", read: "see", update: "edit", delete: "delete" };

export function analyzePermissions({ policies = [], permissions = [], access = [], roles = [] }) {
  const findings = [];
  const roleNames = new Map(roles.map((role) => [String(role.id), role.name ?? String(role.id)]));
  const permissionsByPolicy = groupBy(permissions, (permission) => String(permission.policy));
  const accessByPolicy = groupBy(access, (entry) => String(entry.policy));

  const add = (finding) => findings.push({ ...finding, id: `${finding.rule}:${finding.policyId ?? ""}:${finding.collection ?? ""}:${finding.action ?? ""}:${findings.length}` });

  for (const policy of policies) {
    const policyId = String(policy.id);
    const label = describePolicy(policy);
    const assignments = accessByPolicy.get(policyId) ?? [];
    const isPublic = assignments.some((entry) => !entry.role && !entry.user);
    const rules = permissionsByPolicy.get(policyId) ?? [];
    const base = { policyId, policyName: policy.name ?? null };

    if (policy.admin_access) {
      if (isPublic) {
        add({
          ...base,
          rule: "PUBLIC_ADMIN",
          severity: "critical",
          title: "Anyone can act as an administrator without logging in",
          detail: `The admin policy ${label} is given to public visitors, so anyone on the internet can change or delete everything.`,
          hint: "Remove this policy from Public access right away."
        });
      }
      if (!policy.enforce_tfa) {
        add({
          ...base,
          rule: "ADMIN_NO_TFA",
          severity: "medium",
          title: "Admins can sign in without two-factor authentication",
          detail: `The admin policy ${label} doesn't require 2FA, so a stolen password is enough to take over the project.`,
          hint: "Open the policy and turn on \"Require 2FA\"."
        });
      }
      add({
        ...base,
        rule: "ADMIN_POLICY",
        severity: "info",
        title: "This policy gives full admin access",
        detail: `The policy ${label} can do everything. It is given to: ${describeAssignments(assignments, roleNames)}.`,
        hint: "Keep the number of people with admin access as small as possible."
      });
      continue;
    }

    if (assignments.length === 0) {
      add({
        ...base,
        rule: "UNASSIGNED_POLICY",
        severity: "low",
        title: "Policy isn't used by anyone",
        detail: `The policy ${label} isn't attached to any role or user, so it has no effect.`,
        hint: "Delete it if you don't need it, or attach it to a role."
      });
    }

    if (rules.length === 0 && !policy.app_access) {
      add({
        ...base,
        rule: "EMPTY_POLICY",
        severity: "low",
        title: "Policy doesn't allow anything",
        detail: `The policy ${label} has no permissions and no app access, so attaching it changes nothing.`,
        hint: "Add the permissions it should give, or delete it."
      });
    }

    const seen = new Map();
    for (const rule of rules) {
      const { collection, action } = rule;
      const where = { ...base, collection, action };
      const name = describeCollection(collection);
      const verb = VERBS[action] ?? action;
      const fields = toFieldList(rule.fields);
      const key = `${collection}:${action}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);

      if (isPublic) {
        const privileged = PRIVILEGED_COLLECTIONS.has(collection) || SENSITIVE_READ_COLLECTIONS.has(collection);
        if (WRITE_ACTIONS.includes(action)) {
          add({
            ...where,
            rule: "PUBLIC_WRITE",
            severity: "critical",
            title: `Anyone can ${verb} ${name} without logging in`,
            detail: `Through the policy ${label}, public visitors can ${verb} items in ${name}, which makes spam or data loss easy.`,
            hint: "Remove this permission from Public access, or limit it to logged-in roles."
          });
        } else if (action === "read") {
          const unfiltered = isEmptyFilter(rule.permissions);
          add({
            ...where,
            rule: "PUBLIC_READ",
            severity: privileged ? "critical" : unfiltered ? "high" : "medium",
            title: `Anyone can see ${name} without logging in`,
            detail: `Through the policy ${label}, public visitors can see ${unfiltered ? "every item" : "some items"} in ${name}${
              hasWildcard(fields) ? ", including every field" : ""
            }${privileged ? ". This is private system data" : ""}.`,
            hint: "Allow only the fields you need and limit it to published items (for example Status = published)."
          });
        }
      }

      if (PRIVILEGED_COLLECTIONS.has(collection) && WRITE_ACTIONS.includes(action)) {
        add({
          ...where,
          rule: "PRIVILEGED_WRITE",
          severity: "high",
          title: `Non-admins can ${verb} ${name}`,
          detail: `The policy ${label} can ${verb} ${name}, which lets people give themselves more rights or change how the project works.`,
          hint: "Leave this to administrators, or add a strict item rule."
        });
      }

      if (action === "read" && SENSITIVE_READ_COLLECTIONS.has(collection) && hasWildcard(fields)) {
        add({
          ...where,
          rule: "SENSITIVE_READ_ALL_FIELDS",
          severity: "high",
          title: `Every field of ${name} is visible`,
          detail: `The policy ${label} can see all fields of ${name}, which can include private details such as emails, tokens or settings.`,
          hint: "Allow only the fields people actually need."
        });
      }

      if (action === "delete" && isEmptyFilter(rule.permissions)) {
        add({
          ...where,
          rule: "UNRESTRICTED_DELETE",
          severity: "high",
          title: `Any item in ${name} can be deleted`,
          detail: `The policy ${label} can delete every item in ${name}, including other people's work.`,
          hint: "Add an item rule, for example only items they created (User Created = current user)."
        });
      }

      if ((action === "create" || action === "update") && hasWildcard(fields) && !PRIVILEGED_COLLECTIONS.has(collection)) {
        add({
          ...where,
          rule: "WILDCARD_WRITE",
          severity: "medium",
          title: `Every field of ${name} can be ${action === "create" ? "filled in" : "edited"}`,
          detail: `The policy ${label} allows all fields, so fields added later will be ${action === "create" ? "fillable" : "editable"} too.`,
          hint: "Pick the allowed fields one by one instead of \"All fields\"."
        });
      }

      if (action === "read") {
        const exposed = fields.filter((field) => SENSITIVE_FIELD_PATTERN.test(field));
        if (exposed.length > 0) {
          add({
            ...where,
            rule: "SENSITIVE_FIELD_EXPOSED",
            severity: isPublic ? "high" : "medium",
            title: `Secret-looking fields in ${name} are visible`,
            detail: `The policy ${label} can see ${exposed.join(", ")}, which look like passwords or keys.`,
            hint: "Remove these fields from what the policy can see."
          });
        }
      }
    }

    for (const [key, count] of seen) {
      if (count > 1) {
        const [collection, action] = key.split(":");
        add({
          ...base,
          collection,
          action,
          rule: "DUPLICATE_PERMISSION",
          severity: "low",
          title: `Several "${action}" rules for ${describeCollection(collection)}`,
          detail: `The policy ${label} has ${count} separate ${action} rules for ${describeCollection(collection)}. They are combined, which makes it harder to see what is allowed.`,
          hint: "Merge them into a single rule."
        });
      }
    }
  }

  findings.sort(
    (left, right) =>
      SEVERITIES.indexOf(left.severity) - SEVERITIES.indexOf(right.severity) ||
      String(left.policyName ?? left.policyId).localeCompare(String(right.policyName ?? right.policyId))
  );

  return {
    findings,
    summary: summarize(findings, policies, permissions)
  };
}

function summarize(findings, policies, permissions) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) bySeverity[finding.severity] += 1;
  return {
    policies: policies.length,
    permissions: permissions.length,
    findings: findings.length,
    bySeverity
  };
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export { SEVERITIES };
