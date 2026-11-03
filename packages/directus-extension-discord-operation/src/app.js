/**
 * Discord Operation UI Configuration
 *
 * Only "Send with", the connection and the message are shown by default. Everything else
 * (bot mode, embeds, images, footer, raw JSON) sits behind the "More options"
 * toggle. Option keys are unchanged so saved flows keep working; hiding a
 * field never clears its saved value.
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
 * @param {Object} [rule] - Extra filter rule, e.g. { messageType: { _eq: "embed" } }
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

const EMBED = { messageType: { _eq: "embed" } };

const shorten = (value, max = 60) => {
    const text = String(value ?? "").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export default {
    id: "discord",
    name: "Send Discord Message",
    icon: "chat_bubble",
    description: "Send a message to a Discord channel",

    // Never shows the webhook URL (it contains a secret) or the bot token
    overview: ({ integrationMethod, channelId, messageType, message, embedTitle }) => [
        {
            label: "Channel",
            text: integrationMethod === "bot" ? channelId || "Not set" : channelId ? "Webhook" : "Not set",
        },
        {
            label: "Message",
            text: shorten(messageType === "embed" ? embedTitle : message) || "Not set",
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
                        { text: "Discord bot", value: "bot" },
                    ],
                },
                note: "Webhook needs only a URL. Bot mode needs a bot token and can post to any channel or thread it can see.",
            },
            schema: {
                default_value: "webhook",
                is_nullable: false,
            },
        },
        {
            field: "channelId",
            name: "Webhook URL / Channel ID",
            type: "string",
            meta: {
                width: "full",
                interface: "input",
                required: true,
                options: {
                    placeholder: "https://discord.com/api/webhooks/123/abc",
                },
                note: "Channel settings > Integrations > Webhooks > Copy URL. In bot mode: the channel ID, e.g. 123456789012345678.",
                conditions: [
                    {
                        rule: { integrationMethod: { _eq: "bot" } },
                        options: { placeholder: "123456789012345678" },
                    },
                ],
            },
            schema: {
                is_nullable: false,
            },
            required: true,
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
                    placeholder: "Paste the bot token",
                },
                note: "Discord Developer Portal > your app > Bot > Reset Token.",
                conditions: whenEquals("integrationMethod", "bot", true),
            },
        },
        {
            field: "message",
            name: "Message",
            type: "text",
            meta: {
                width: "full",
                interface: "input-multiline",
                options: {
                    placeholder: "New order {{$trigger.payload.id}} was placed",
                },
                note: "Plain text or Markdown, e.g. **New order** {{$trigger.payload.id}}.",
                conditions: whenEquals("messageType", "simple", true),
            },
        },
        {
            field: "embedTitle",
            name: "Title",
            type: "string",
            meta: {
                width: "full",
                interface: "input",
                options: {
                    placeholder: "New order {{$trigger.payload.id}}",
                },
                note: "Bold heading of the embed, e.g. Order shipped.",
                conditions: whenEquals("messageType", "embed", true),
            },
        },
        {
            field: "embedDescription",
            name: "Text",
            type: "text",
            meta: {
                width: "full",
                interface: "input-multiline",
                options: {
                    placeholder: "Customer {{$trigger.payload.customer}} placed an order",
                },
                note: "Body of the embed. Markdown works, e.g. **bold**.",
                conditions: whenEquals("messageType", "embed", true),
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
                note: "Rich embeds, images, bot mode and more.",
            },
            schema: {
                default_value: false,
            },
        },

        // ============================================
        // MORE OPTIONS: MESSAGE STYLE
        // ============================================
        divider("more_divider_style", "Message style", "palette"),
        more({
            field: "messageType",
            name: "Message type",
            type: "string",
            meta: {
                width: "full",
                interface: "select-dropdown",
                options: {
                    choices: [
                        { text: "Plain message", value: "simple" },
                        { text: "Embed (title, colour, images)", value: "embed" },
                    ],
                },
                note: "Embed shows a card with a title, colour bar and optional images.",
            },
            schema: {
                default_value: "simple",
                is_nullable: false,
            },
        }),
        more(
            {
                field: "embedTemplate",
                name: "Colour",
                type: "string",
                meta: {
                    width: "half",
                    interface: "select-dropdown",
                    options: {
                        choices: [
                            { text: "🟦 Basic", value: "basic" },
                            { text: "🟩 Success", value: "success" },
                            { text: "🟥 Error", value: "error" },
                            { text: "⬜️ Info", value: "info" },
                        ],
                    },
                    note: "Colour bar and default footer, e.g. Success.",
                },
                schema: {
                    default_value: "basic",
                },
            },
            EMBED,
            true
        ),
        more(
            {
                field: "embedTimestamp",
                name: "Timestamp",
                type: "boolean",
                meta: {
                    width: "half",
                    interface: "boolean",
                    options: {
                        label: "Show the current time",
                    },
                },
            },
            EMBED
        ),
        more(
            {
                field: "embedImage",
                name: "Image URL",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "https://example.com/photo.png",
                    },
                    note: "Large image at the bottom.",
                },
            },
            EMBED
        ),
        more(
            {
                field: "embedThumbnail",
                name: "Thumbnail URL",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "https://example.com/logo.png",
                    },
                    note: "Small image in the top-right corner.",
                },
            },
            EMBED
        ),

        // ============================================
        // MORE OPTIONS: FOOTER & AUTHOR (embed)
        // ============================================
        divider("more_divider_footer", "Footer & author", "badge", EMBED),
        more(
            {
                field: "embedFooterText",
                name: "Footer text",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "Sent from Directus",
                    },
                },
            },
            EMBED
        ),
        more(
            {
                field: "embedFooterIcon",
                name: "Footer icon URL",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "https://example.com/icon.png",
                    },
                },
            },
            EMBED
        ),
        more(
            {
                field: "embedAuthorName",
                name: "Author name",
                type: "string",
                meta: {
                    width: "full",
                    interface: "input",
                    options: {
                        placeholder: "Directus",
                    },
                    note: "Shown above the title.",
                },
            },
            EMBED
        ),
        more(
            {
                field: "embedAuthorIcon",
                name: "Author icon URL",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "https://example.com/avatar.png",
                    },
                },
            },
            EMBED
        ),
        more(
            {
                field: "embedAuthorUrl",
                name: "Author link",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "https://example.com",
                    },
                },
            },
            EMBED
        ),

        // ============================================
        // MORE OPTIONS: ADVANCED (embed)
        // ============================================
        divider("more_divider_advanced", "Advanced: custom JSON", "code", EMBED),
        more(
            {
                field: "embedFields",
                name: "Embed fields (JSON)",
                type: "text",
                meta: {
                    width: "full",
                    interface: "input-multiline",
                    options: {
                        placeholder: '[{"name": "Status", "value": "Paid", "inline": true}]',
                    },
                    note: "List of { name, value, inline } shown as a small table in the embed.",
                },
            },
            EMBED
        ),
    ],
};
