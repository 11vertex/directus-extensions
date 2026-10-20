/**
 * Microsoft Teams Operation UI Configuration
 *
 * Only the webhook URL, title and text are shown by default. Style, image,
 * buttons, mentions and raw Adaptive Card JSON sit behind the "More options"
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
 * @param {Object} [rule] - Extra filter rule, e.g. { messageType: { _eq: "raw" } }
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

const CARD = { messageType: { _eq: "card" } };
const RAW = { messageType: { _eq: "raw" } };

const STYLE_LABELS = {
    default: "Default",
    accent: "Accent (blue)",
    good: "Success (green)",
    warning: "Warning (yellow)",
    attention: "Attention (red)",
};

const shorten = (value, max = 60) => {
    const text = String(value ?? "").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export default {
    id: "teams",
    name: "Send Microsoft Teams Message",
    icon: "groups",
    description: "Send a message to a Microsoft Teams channel",

    // The webhook URL is never shown: it contains a signature
    overview: ({ webhookUrl, messageType, title, text }) => [
        ...(webhookUrl ? [] : [{ label: "Webhook", text: "Not set" }]),
        ...(messageType === "raw"
            ? [{ label: "Message", text: "Custom card (JSON)" }]
            : [
                  { label: "Title", text: shorten(title) || "Not set" },
                  { label: "Message", text: shorten(text) || "Not set" },
              ]),
    ],

    options: [
        // ============================================
        // DEFAULT VIEW
        // ============================================
        {
            field: "webhookUrl",
            name: "Webhook URL",
            type: "string",
            meta: {
                width: "full",
                interface: "input",
                required: true,
                options: {
                    placeholder: "https://...powerplatform.com/powerautomate/automations/direct/workflows/...",
                    masked: true,
                    trim: true,
                },
                note: "In Teams: channel ⋯ > Workflows > \"Send webhook alerts to a channel\", then copy the link.",
            },
            schema: {
                is_nullable: false,
            },
        },
        {
            field: "title",
            name: "Title",
            type: "string",
            meta: {
                width: "full",
                interface: "input",
                options: {
                    placeholder: "New article: {{$trigger.payload.title}}",
                },
                note: "Bold heading of the card, e.g. New order received.",
                conditions: whenEquals("messageType", "card"),
            },
        },
        {
            field: "text",
            name: "Message",
            type: "text",
            meta: {
                width: "full",
                interface: "input-multiline",
                options: {
                    placeholder: "**{{$trigger.payload.title}}** was published",
                },
                note: "Markdown works, e.g. **bold** and [links](https://example.com).",
                conditions: whenEquals("messageType", "card"),
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
                note: "Colour, image, buttons, mentions and custom cards.",
            },
            schema: {
                default_value: false,
            },
        },

        // ============================================
        // MORE OPTIONS: LOOK
        // ============================================
        divider("more_divider_look", "Look", "palette"),
        more(
            {
                field: "style",
                name: "Colour",
                type: "string",
                meta: {
                    width: "half",
                    interface: "select-dropdown",
                    options: {
                        choices: Object.entries(STYLE_LABELS).map(([value, text]) => ({ text, value })),
                    },
                    note: "Colours the title, e.g. Success (green).",
                },
                schema: {
                    default_value: "default",
                },
            },
            CARD
        ),
        more({
            field: "fullWidth",
            name: "Full width",
            type: "boolean",
            meta: {
                width: "half",
                interface: "boolean",
                options: {
                    label: "Stretch the card to the full message width",
                },
            },
            schema: {
                default_value: false,
            },
        }),
        more(
            {
                field: "imageUrl",
                name: "Image URL",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "https://example.com/image.png",
                    },
                    note: "A public image shown below the text.",
                },
            },
            CARD
        ),
        more(
            {
                field: "imageAlt",
                name: "Image description",
                type: "string",
                meta: {
                    width: "half",
                    interface: "input",
                    options: {
                        placeholder: "Product photo",
                    },
                },
            },
            CARD
        ),

        // ============================================
        // MORE OPTIONS: ADVANCED (JSON)
        // ============================================
        divider("more_divider_advanced", "Advanced: custom JSON", "code"),
        more(
            {
                field: "actions",
                name: "Buttons (JSON)",
                type: "json",
                meta: {
                    width: "full",
                    interface: "input-code",
                    options: {
                        language: "json",
                        placeholder: '[{ "title": "Open in Directus", "url": "https://cms.example.com/admin/content/articles/{{$trigger.key}}" }]',
                    },
                    note: 'Up to 5 link buttons, e.g. [{ "title": "Open", "url": "https://..." }].',
                },
            },
            CARD
        ),
        more(
            {
                field: "facts",
                name: "Facts (JSON)",
                type: "json",
                meta: {
                    width: "full",
                    interface: "input-code",
                    options: {
                        language: "json",
                        placeholder: '{ "Status": "{{$trigger.payload.status}}" }',
                    },
                    note: 'Label/value list, e.g. { "Status": "Published" }.',
                },
            },
            CARD
        ),
        more({
            field: "mentions",
            name: "Mentions (JSON)",
            type: "json",
            meta: {
                width: "full",
                interface: "input-code",
                options: {
                    language: "json",
                    placeholder: '[{ "id": "jane.doe@contoso.com", "name": "Jane Doe" }]',
                },
                note: "Email (or Entra id) and name; add <at>Jane Doe</at> to the text to place it.",
            },
        }),
        more({
            field: "messageType",
            name: "Card type",
            type: "string",
            meta: {
                width: "full",
                interface: "select-dropdown",
                options: {
                    choices: [
                        { text: "Simple card (title and message)", value: "card" },
                        { text: "Custom Adaptive Card JSON", value: "raw" },
                    ],
                },
                note: "Custom: paste a card from adaptivecards.microsoft.com/designer.",
            },
            schema: {
                default_value: "card",
                is_nullable: false,
            },
        }),
        more(
            {
                field: "cardJson",
                name: "Adaptive Card JSON",
                type: "json",
                meta: {
                    width: "full",
                    interface: "input-code",
                    options: {
                        language: "json",
                        placeholder:
                            '{ "type": "AdaptiveCard", "version": "1.4", "body": [{ "type": "TextBlock", "text": "Hello from Directus", "wrap": true }] }',
                    },
                    note: 'An object with "type": "AdaptiveCard". Version defaults to 1.4.',
                },
            },
            RAW,
            true
        ),
    ],
};
