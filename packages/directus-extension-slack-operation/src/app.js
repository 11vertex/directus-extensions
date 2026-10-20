/**
 * Slack Operation UI Configuration
 *
 * Only the connection and the message are shown by default. Mentions, Block
 * Kit, bot mode and thread options sit behind the "More options" toggle.
 * Option keys are unchanged so saved flows keep working; hiding a field never
 * clears its saved value.
 *
 * Directus conditions: the last matching condition wins and each rule must
 * have exactly one top-level key, so combined rules use `_and`.
 */

const MORE = { show_more_options: { _eq: true } };

/**
 * Shows a field only when `field` equals `value`, hides it otherwise
 * @param {string} field - Option field the rule depends on
 * @param {string} value - Value that makes the field visible
 * @param {boolean} required - Whether the field is required when visible
 * @returns {Array} Condition objects
 */
const whenEquals = (field, value, required = false) => [
    { rule: { [field]: { _eq: value } }, hidden: false, required },
    { rule: { [field]: { _neq: value } }, hidden: true, required: false },
];

/**
 * Hides an option unless "More options" is on (and `rule` matches, when given)
 * @param {Object} option - Option definition
 * @param {Object} [rule] - Extra filter rule, e.g. { blocksMode: { _eq: "builder" } }
 * @param {boolean} [required] - Whether the field is required when visible
 * @returns {Object} Option definition
 */
const more = (option, rule, required = false) => ({
    ...option,
    meta: {
        ...option.meta,
        hidden: true,
        conditions: [{ rule: rule ? { _and: [MORE, rule] } : MORE, hidden: false, required }],
    },
});

/**
 * Section divider shown inside "More options"
 */
const divider = (field, title, icon, rule) =>
    more(
        {
            field,
            type: "alias",
            meta: { interface: "presentation-divider", special: ["alias", "no-data"], width: "full", options: { title, icon } },
        },
        rule
    );

const BOT = { integrationMethod: { _eq: "bot" } };
const BUILDER = { blocksMode: { _eq: "builder" } };
const RAW = { blocksMode: { _eq: "raw" } };

const shorten = (value, max = 60) => {
    const text = String(value ?? "").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export default {
    id: "slack",
    name: "Send Slack Message",
    icon: "tag",
    description: "Send a message to a Slack channel",

    // Never shows the webhook URL or the bot token
    overview: ({ integrationMethod, channel, text }) => [
        {
            label: "Channel",
            text: integrationMethod === "bot" ? channel || "Not set" : "Webhook",
        },
        {
            label: "Message",
            text: shorten(text) || "Not set",
        },
    ],

    options: [
        // ============================================
        // DEFAULT VIEW
        // ============================================
        {
            field: "integrationMethod",
            name: "Send with",
            type: "string",
            meta: {
                width: "full",
                interface: "select-dropdown",
                options: {
                    choices: [
                        { text: "Webhook (simplest)", value: "webhook" },
                        { text: "Slack bot", value: "bot" },
                    ],
                },
                note: "A webhook posts to one fixed channel and needs only a URL. A bot needs a token, can pick the channel and reply in threads.",
            },
            schema: {
                default_value: "webhook",
                is_nullable: false,
            },
        },
        {
            field: "webhookUrl",
            name: "Webhook URL",
            type: "string",
            meta: {
                width: "full",
                interface: "input",
                special: ["password"],
                options: {
                    placeholder: "https://hooks.slack.com/services/T000/B000/XXXX",
                    masked: true,
                },
                note: "In your Slack app: Incoming Webhooks > Add New Webhook > Copy.",
                conditions: whenEquals("integrationMethod", "webhook", true),
            },
        },
        {
            field: "token",
            name: "Bot token",
            type: "string",
            meta: {
                width: "full",
                interface: "input",
                special: ["password"],
                options: {
                    placeholder: "xoxb-...",
                    masked: true,
                },
                note: "Starts with xoxb-. The app needs the chat:write scope.",
                conditions: whenEquals("integrationMethod", "bot", true),
            },
        },
        {
            field: "channel",
            name: "Channel",
            type: "string",
            meta: {
                width: "full",
                interface: "input",
                options: {
                    placeholder: "#alerts",
                },
                note: "Channel name or ID, e.g. #alerts or C0123456789 (IDs survive renames).",
                conditions: whenEquals("integrationMethod", "bot", true),
            },
        },
        {
            field: "text",
            name: "Message",
            type: "text",
            meta: {
                width: "full",
                interface: "input-multiline",
                required: true,
                options: {
                    placeholder: "New order *{{$trigger.payload.id}}* was placed",
                },
                note: "Slack formatting works, e.g. *bold* and {{$trigger.payload.title}}.",
            },
            schema: {
                is_nullable: false,
            },
        },
        {
            field: "show_more_options",
            name: "More options",
            type: "boolean",
            meta: {
                width: "full",
                interface: "boolean",
                options: {
                    label: "Show more options",
                },
                note: "Mentions, buttons, bot mode, threads and more.",
            },
            schema: {
                default_value: false,
            },
        },

        // ============================================
        // MORE OPTIONS: MENTIONS
        // ============================================
        divider("more_divider_mentions", "Mentions", "alternate_email"),
        more({
            field: "mentionHere",
            name: "Mention @here",
            type: "boolean",
            meta: {
                width: "half",
                interface: "boolean",
                options: {
                    label: "Notify active members",
                },
            },
            schema: {
                default_value: false,
            },
        }),
        more({
            field: "mentionChannel",
            name: "Mention @channel",
            type: "boolean",
            meta: {
                width: "half",
                interface: "boolean",
                options: {
                    label: "Notify all members",
                },
            },
            schema: {
                default_value: false,
            },
        }),
        more({
            field: "mentionUsers",
            name: "Mention people",
            type: "csv",
            meta: {
                width: "full",
                interface: "tags",
                options: {
                    placeholder: "U012ABCDEF",
                },
                note: "Member IDs, e.g. U012ABCDEF (profile > ⋮ > Copy member ID).",
            },
        }),

        // ============================================
        // MORE OPTIONS: LAYOUT (Block Kit builder)
        // ============================================
        divider("more_divider_layout", "Layout", "view_agenda"),
        more({
            field: "blocksMode",
            name: "Layout",
            type: "string",
            meta: {
                width: "full",
                interface: "select-dropdown",
                options: {
                    choices: [
                        { text: "Just the message", value: "none" },
                        { text: "Header, fields and button", value: "builder" },
                        { text: "Custom JSON (Block Kit)", value: "raw" },
                    ],
                },
                note: "The message above is still sent as the notification text.",
            },
            schema: {
                default_value: "none",
                is_nullable: false,
            },
        }),
        more(
            {
                field: "headerText",
                name: "Header",
                type: "string",
                meta: {
                    width: "full",
                    interface: "input",
                    options: {
                        placeholder: "Deployment finished",
                    },
                    note: "Large heading, max 150 characters.",
                },
            },
            BUILDER
        ),
        more(
            {
                field: "sectionText",
                name: "Body",
                type: "text",
                meta: {
                    width: "full",
                    interface: "input-multiline",
                    options: {
                        placeholder: "Item *{{$trigger.key}}* was updated",
                    },
                    note: "Text under the header, e.g. Order *42* shipped.",
                },
            },
            BUILDER
        ),
        more(
            {
                field: "fields",
                name: "Fields",
                type: "json",
                meta: {
                    width: "full",
                    interface: "list",
                    options: {
                        template: "{{ title }}: {{ value }}",
                        addLabel: "Add Field",
                        fields: [
                            {
                                field: "title",
                                name: "Title",
                                type: "string",
                                meta: { width: "half", interface: "input" },
                            },
                            {
                                field: "value",
                                name: "Value",
                                type: "string",
                                meta: { width: "half", interface: "input" },
                            },
                        ],
                    },
                    note: "Up to 10 label/value pairs, e.g. Status: Paid.",
                },
            },
            BUILDER
        ),
        more(
            {
                field: "buttonText",
                name: "Button text",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "Open in Directus",
                    },
                },
            },
            BUILDER
        ),
        more(
            {
                field: "buttonUrl",
                name: "Button link",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "https://example.com/admin/content/...",
                    },
                    note: "Adds a link button when set.",
                },
            },
            BUILDER
        ),

        // ============================================
        // MORE OPTIONS: BOT ONLY
        // ============================================
        divider("more_divider_connection", "Bot options", "smart_toy", BOT),
        more(
            {
                field: "threadTs",
                name: "Reply in thread",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "{{$last.ts}}",
                    },
                    note: "The parent message ts, e.g. {{$last.ts}}.",
                },
            },
            BOT
        ),
        more(
            {
                field: "replyBroadcast",
                name: "Also send to channel",
                type: "boolean",
                meta: {
                    width: "half",
                    interface: "boolean",
                    options: {
                        label: "Broadcast thread reply",
                    },
                    note: "Only used with a thread reply.",
                },
                schema: {
                    default_value: false,
                },
            },
            BOT
        ),
        more(
            {
                field: "username",
                name: "Sender name",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "Directus",
                    },
                    note: "Needs the chat:write.customize scope.",
                },
            },
            BOT
        ),
        more(
            {
                field: "iconEmoji",
                name: "Sender emoji",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: ":robot_face:",
                    },
                    note: "Needs the chat:write.customize scope.",
                },
            },
            BOT
        ),

        // ============================================
        // MORE OPTIONS: ADVANCED (raw blocks)
        // ============================================
        divider("more_divider_advanced", "Advanced: custom JSON", "code", RAW),
        more(
            {
                field: "rawBlocks",
                name: "Blocks JSON",
                type: "json",
                meta: {
                    width: "full",
                    interface: "input-code",
                    options: {
                        language: "json",
                        placeholder: '[{"type": "section", "text": {"type": "mrkdwn", "text": "Hello"}}]',
                    },
                    note: "A JSON array of blocks, e.g. from app.slack.com/block-kit-builder.",
                },
            },
            RAW,
            true
        ),
    ],
};
