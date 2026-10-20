/**
 * Slack Payload Builder
 *
 * Pure helpers that turn the (already mustache-rendered) operation options
 * into a Slack request description. No network access happens here, which
 * keeps the logic easy to unit test.
 */

export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

const WEBHOOK_URL_PATTERN = /^https:\/\/hooks\.slack(-gov)?\.com\/\S+$/;
const USER_ID_PATTERN = /^[UW][A-Z0-9]+$/;
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

// Slack Block Kit limits, see https://api.slack.com/reference/block-kit/blocks
const MAX_BLOCKS = 50;
const MAX_SECTION_FIELDS = 10;
const MAX_HEADER_LENGTH = 150;

/**
 * Trims strings and turns empty values into undefined
 * @param {*} value - Any option value
 * @returns {string|undefined} Trimmed string or undefined when empty
 */
export const clean = (value) => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
};

/**
 * Interprets boolean-like option values (Directus may render templates to strings)
 * @param {*} value - Option value
 * @returns {boolean} True for true / "true" / "1"
 */
export const toBoolean = (value) => value === true || value === "true" || value === "1" || value === 1;

/**
 * Parses a JSON option that may arrive as a string or as an already-parsed value
 * @param {*} value - Option value
 * @param {string} label - Human readable option name used in errors
 * @returns {*} Parsed value, or undefined when empty
 * @throws {Error} If the string is not valid JSON
 */
export const parseJsonOption = (value, label) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;

    const text = value.trim();
    if (!text) return undefined;

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} is not valid JSON: ${error.message}`);
    }
};

/**
 * Builds the mention prefix (e.g. "<!here> <@U123>")
 * @param {Object} options - Mention options
 * @param {string|string[]} options.mentionUsers - Comma/space separated user ids or an array
 * @param {boolean} options.mentionHere - Add @here
 * @param {boolean} options.mentionChannel - Add @channel
 * @returns {string} Mention prefix, empty string when no mentions
 * @throws {Error} If a user id is malformed
 */
export const buildMentions = ({ mentionUsers, mentionHere, mentionChannel } = {}) => {
    const mentions = [];

    if (toBoolean(mentionChannel)) mentions.push("<!channel>");
    if (toBoolean(mentionHere)) mentions.push("<!here>");

    // Accept an array (tags interface), a JSON array string, or a comma/space separated string
    const isJsonList = typeof mentionUsers === "string" && mentionUsers.trim().startsWith("[");
    const parsedUsers = isJsonList ? parseJsonOption(mentionUsers, "Mention user IDs") : mentionUsers;
    const userList = Array.isArray(parsedUsers) ? parsedUsers : String(parsedUsers ?? "").split(/[\s,]+/);

    for (const raw of userList) {
        // Accept "U123", "@U123" and "<@U123>"
        const id = clean(raw)?.replace(/^<?@/, "").replace(/>$/, "");
        if (!id) continue;
        if (!USER_ID_PATTERN.test(id)) {
            throw new Error(`Invalid Slack user ID "${id}". Expected an ID like U012ABCDEF`);
        }
        mentions.push(`<@${id}>`);
    }

    return [...new Set(mentions)].join(" ");
};

/**
 * Converts one builder field entry to a mrkdwn text object
 * Accepts strings or { title, value } / { label, value } objects
 */
const toFieldText = (field) => {
    if (typeof field === "string") return clean(field);
    if (!field || typeof field !== "object") return undefined;

    const title = clean(field.title ?? field.label ?? field.name);
    const value = clean(field.value ?? field.text);
    if (title && value) return `*${title}*\n${value}`;
    return title ?? value;
};

/**
 * Builds Block Kit blocks from the simple builder options
 * @param {Object} options - Builder options
 * @returns {Array} Array of Block Kit blocks
 * @throws {Error} If the builder input is invalid or empty
 */
export const buildBuilderBlocks = ({ headerText, sectionText, fields, buttonText, buttonUrl } = {}) => {
    const blocks = [];
    const header = clean(headerText);
    const section = clean(sectionText);
    const url = clean(buttonUrl);

    if (header) {
        if (header.length > MAX_HEADER_LENGTH) {
            throw new Error(`Header text must be ${MAX_HEADER_LENGTH} characters or fewer`);
        }
        blocks.push({ type: "header", text: { type: "plain_text", text: header, emoji: true } });
    }

    const parsedFields = parseJsonOption(fields, "Fields") ?? [];
    if (!Array.isArray(parsedFields)) {
        throw new Error("Fields must be a list");
    }
    const fieldTexts = parsedFields.map(toFieldText).filter(Boolean);
    if (fieldTexts.length > MAX_SECTION_FIELDS) {
        throw new Error(`Slack allows at most ${MAX_SECTION_FIELDS} fields per section`);
    }

    if (section || fieldTexts.length > 0) {
        blocks.push({
            type: "section",
            ...(section && { text: { type: "mrkdwn", text: section } }),
            ...(fieldTexts.length > 0 && {
                fields: fieldTexts.map((text) => ({ type: "mrkdwn", text })),
            }),
        });
    }

    if (url) {
        if (!HTTP_URL_PATTERN.test(url)) {
            throw new Error("Button URL must start with http:// or https://");
        }
        blocks.push({
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: clean(buttonText) ?? "Open", emoji: true },
                    url,
                },
            ],
        });
    }

    if (blocks.length === 0) {
        throw new Error("Block builder needs at least a header, section text, fields or a button URL");
    }

    return blocks;
};

/**
 * Parses and validates raw Block Kit JSON
 * @param {string|Array} rawBlocks - JSON string or array of blocks
 * @returns {Array} Array of blocks
 * @throws {Error} If the value is missing, invalid JSON, not an array or malformed
 */
export const parseRawBlocks = (rawBlocks) => {
    const blocks = parseJsonOption(rawBlocks, "Blocks JSON");

    if (blocks === undefined) {
        throw new Error("Blocks JSON is required when using raw blocks");
    }
    if (!Array.isArray(blocks)) {
        throw new Error("Blocks JSON must be an array of Block Kit blocks");
    }
    if (blocks.length === 0) {
        throw new Error("Blocks JSON must contain at least one block");
    }
    if (blocks.length > MAX_BLOCKS) {
        throw new Error(`Slack allows at most ${MAX_BLOCKS} blocks per message`);
    }
    blocks.forEach((block, index) => {
        if (!block || typeof block !== "object" || Array.isArray(block) || typeof block.type !== "string") {
            throw new Error(`Block at index ${index} must be an object with a "type" property`);
        }
    });

    return blocks;
};

/**
 * Resolves the blocks for the selected blocks mode
 * @param {Object} options - Operation options
 * @param {string} mentions - Mention prefix
 * @returns {Array|undefined} Blocks or undefined for plain text messages
 */
const resolveBlocks = (options, mentions) => {
    const mode = options.blocksMode ?? "none";

    if (mode === "none") return undefined;

    const blocks = mode === "builder" ? buildBuilderBlocks(options) : mode === "raw" ? parseRawBlocks(options.rawBlocks) : null;
    if (!blocks) {
        throw new Error("blocksMode must be one of 'none', 'builder' or 'raw'");
    }

    // Mentions only notify when they are part of the rendered message, so put them on top
    return mentions ? [{ type: "section", text: { type: "mrkdwn", text: mentions } }, ...blocks] : blocks;
};

/**
 * Builds the Slack request description from operation options
 * @param {Object} options - Operation options (already rendered by Directus)
 * @returns {{ url: string, headers: Object, payload: Object, integrationMethod: string }}
 * @throws {Error} If validation fails. Messages never contain the token or webhook URL.
 */
export const buildSlackRequest = (options = {}) => {
    const integrationMethod = clean(options.integrationMethod) ?? "webhook";
    if (integrationMethod !== "webhook" && integrationMethod !== "bot") {
        throw new Error("integrationMethod must be either 'webhook' or 'bot'");
    }

    const text = clean(options.text);
    if (!text) {
        throw new Error("Message text is required (it is also used as the notification fallback)");
    }

    const mentions = buildMentions(options);
    const blocks = resolveBlocks(options, mentions);
    const payload = {
        text: mentions ? `${mentions} ${text}` : text,
        ...(blocks && { blocks }),
    };

    if (integrationMethod === "webhook") {
        const webhookUrl = clean(options.webhookUrl);
        if (!webhookUrl) {
            throw new Error("Webhook URL is required when using the Incoming Webhook method");
        }
        if (!WEBHOOK_URL_PATTERN.test(webhookUrl)) {
            throw new Error("Invalid webhook URL format. Expected: https://hooks.slack.com/services/...");
        }

        return {
            integrationMethod,
            url: webhookUrl,
            headers: { "Content-Type": "application/json" },
            payload,
        };
    }

    const token = clean(options.token);
    if (!token) {
        throw new Error("Bot token is required when using the Bot method");
    }

    const channel = clean(options.channel);
    if (!channel) {
        throw new Error("Channel ID or name is required when using the Bot method");
    }

    const threadTs = clean(options.threadTs);
    const username = clean(options.username);
    const iconEmoji = clean(options.iconEmoji);

    return {
        integrationMethod,
        url: SLACK_POST_MESSAGE_URL,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
        },
        payload: {
            channel,
            ...payload,
            ...(threadTs && { thread_ts: threadTs }),
            ...(threadTs && toBoolean(options.replyBroadcast) && { reply_broadcast: true }),
            ...(username && { username }),
            ...(iconEmoji && { icon_emoji: iconEmoji.startsWith(":") ? iconEmoji : `:${iconEmoji}:` }),
        },
    };
};
