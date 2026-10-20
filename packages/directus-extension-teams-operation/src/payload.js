/**
 * Microsoft Teams payload builder
 *
 * Pure functions that turn operation options into the JSON body accepted by a
 * Teams Workflows ("When a Teams webhook request is received") URL or a legacy
 * Incoming Webhook URL. No I/O happens here so everything is unit-testable.
 *
 * Envelope reference:
 * https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
 */

export const CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
export const CARD_VERSION = "1.4";
export const CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";

// Teams rejects messages larger than ~28 KB.
export const MAX_PAYLOAD_BYTES = 28 * 1024;
export const MAX_ACTIONS = 5;

export const STYLES = ["default", "accent", "good", "warning", "attention"];

/**
 * Trims strings, returns undefined for empty / non-string values.
 * @param {unknown} value
 * @returns {string | undefined}
 */
export const clean = (value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
};

/**
 * Parses an option that may arrive as a JSON string (input fields, mustache
 * output) or as an already parsed value (json fields, single-tag templates).
 * @param {unknown} value - Raw option value
 * @param {string} label - Option name used in error messages
 * @returns {unknown} Parsed value, or undefined when empty
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

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toText = (value) => {
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value).trim();
};

const isHttpUrl = (value) => {
    try {
        const { protocol } = new URL(value);
        return protocol === "https:" || protocol === "http:";
    } catch {
        return false;
    }
};

/**
 * Normalizes facts into Adaptive Card FactSet entries.
 * Accepts `[{ "title": "...", "value": "..." }]` (also `name`/`key` instead of
 * `title`) or a plain object `{ "Status": "Published" }`.
 * @param {unknown} value
 * @returns {Array<{title: string, value: string}>}
 */
export const normalizeFacts = (value) => {
    const facts = parseJsonOption(value, "Facts");
    if (facts === undefined) return [];

    if (isObject(facts)) {
        return Object.entries(facts).map(([title, factValue]) => ({ title, value: toText(factValue) }));
    }

    if (!Array.isArray(facts)) {
        throw new Error("Facts must be a JSON array of { title, value } objects or a key/value object");
    }

    return facts.map((fact, index) => {
        const title = isObject(fact) ? toText(fact.title ?? fact.name ?? fact.key) : "";
        if (!title) throw new Error(`Facts[${index}] needs a "title" (or "name"/"key")`);
        return { title, value: toText(fact.value) };
    });
};

/**
 * Normalizes action buttons into Action.OpenUrl entries.
 * Accepts `[{ "title": "Open", "url": "https://..." }]`.
 * @param {unknown} value
 * @returns {Array<{type: string, title: string, url: string}>}
 */
export const normalizeActions = (value) => {
    const actions = parseJsonOption(value, "Actions");
    if (actions === undefined) return [];

    if (!Array.isArray(actions)) {
        throw new Error('Actions must be a JSON array of { "title", "url" } objects');
    }
    if (actions.length > MAX_ACTIONS) {
        throw new Error(`At most ${MAX_ACTIONS} action buttons are supported (got ${actions.length})`);
    }

    return actions.map((action, index) => {
        const title = isObject(action) ? toText(action.title) : "";
        const url = isObject(action) ? toText(action.url) : "";
        if (!title) throw new Error(`Actions[${index}] needs a "title"`);
        if (!isHttpUrl(url)) throw new Error(`Actions[${index}] needs a valid http(s) "url"`);
        return { type: "Action.OpenUrl", title, url };
    });
};

/**
 * Normalizes mentions into Teams `msteams.entities` mention entries.
 * Accepts `[{ "id": "user@contoso.com", "name": "Jane Doe" }]` where `id` is
 * the user's UPN or Microsoft Entra (AAD) object id.
 * @param {unknown} value
 * @returns {Array<{type: string, text: string, mentioned: {id: string, name: string}}>}
 */
export const normalizeMentions = (value) => {
    const mentions = parseJsonOption(value, "Mentions");
    if (mentions === undefined) return [];

    if (!Array.isArray(mentions)) {
        throw new Error('Mentions must be a JSON array of { "id", "name" } objects');
    }

    return mentions.map((mention, index) => {
        const id = isObject(mention) ? toText(mention.id) : "";
        const name = isObject(mention) ? toText(mention.name) : "";
        if (!id) throw new Error(`Mentions[${index}] needs an "id" (UPN or Entra object id)`);
        if (!name) throw new Error(`Mentions[${index}] needs a "name"`);
        return { type: "mention", text: `<at>${name}</at>`, mentioned: { id, name } };
    });
};

/**
 * Builds an Adaptive Card from the simple builder options.
 * @param {Object} options
 * @returns {Object} Adaptive Card
 */
export const buildCard = ({ title, text, style, facts, imageUrl, imageAlt, actions, mentions, fullWidth } = {}) => {
    const cardTitle = clean(title);
    const cardText = clean(text);
    const factSet = normalizeFacts(facts);
    const image = clean(imageUrl);
    const entities = normalizeMentions(mentions);
    const cardStyle = clean(style) ?? "default";

    if (!cardTitle && !cardText && factSet.length === 0) {
        throw new Error("Provide at least a title, text or facts for the card");
    }
    if (!STYLES.includes(cardStyle)) {
        throw new Error(`Style must be one of: ${STYLES.join(", ")}`);
    }
    if (image && !isHttpUrl(image)) {
        throw new Error("Image URL must be a valid http(s) URL");
    }

    const body = [];

    if (cardTitle) {
        const heading = { type: "TextBlock", text: cardTitle, size: "Large", weight: "Bolder", wrap: true };
        body.push(
            cardStyle === "default"
                ? heading
                : { type: "Container", style: cardStyle, bleed: true, items: [heading] }
        );
    }

    if (cardText) body.push({ type: "TextBlock", text: cardText, wrap: true });

    // Teams only renders a mention when its <at>Name</at> tag is in the card text.
    const missingTags = entities.map((entity) => entity.text).filter((tag) => !cardText?.includes(tag));
    if (missingTags.length) body.push({ type: "TextBlock", text: missingTags.join(" "), wrap: true });

    if (factSet.length) body.push({ type: "FactSet", facts: factSet });

    if (image) {
        body.push({ type: "Image", url: image, size: "Stretch", ...(clean(imageAlt) && { altText: clean(imageAlt) }) });
    }

    const card = { $schema: CARD_SCHEMA, type: "AdaptiveCard", version: CARD_VERSION, body };

    const buttons = normalizeActions(actions);
    if (buttons.length) card.actions = buttons;

    return withMsteams(card, { entities, fullWidth });
};

/**
 * Validates a raw Adaptive Card option. Also accepts a full message envelope
 * and unwraps its first Adaptive Card attachment.
 * @param {unknown} value - JSON string or object
 * @param {Object} [extra] - Mentions / full width to merge into the card
 * @returns {Object} Adaptive Card
 */
export const parseRawCard = (value, { mentions, fullWidth } = {}) => {
    let card = parseJsonOption(value, "Adaptive Card JSON");
    if (card === undefined) throw new Error("Adaptive Card JSON is required in raw mode");

    if (isObject(card) && card.type === "message" && Array.isArray(card.attachments)) {
        card = card.attachments.find((item) => item?.contentType === CARD_CONTENT_TYPE)?.content;
    }

    if (!isObject(card) || card.type !== "AdaptiveCard") {
        throw new Error('Adaptive Card JSON must be an object with "type": "AdaptiveCard"');
    }
    if (card.body !== undefined && !Array.isArray(card.body)) {
        throw new Error('Adaptive Card "body" must be an array');
    }
    if (card.actions !== undefined && !Array.isArray(card.actions)) {
        throw new Error('Adaptive Card "actions" must be an array');
    }

    const normalized = { $schema: CARD_SCHEMA, version: CARD_VERSION, ...card };
    return withMsteams(normalized, { entities: normalizeMentions(mentions), fullWidth });
};

/**
 * Merges mention entities and the full-width flag into `card.msteams`.
 * @param {Object} card
 * @param {Object} extra
 * @returns {Object} Card (new object)
 */
const withMsteams = (card, { entities = [], fullWidth } = {}) => {
    if (!entities.length && !fullWidth) return card;

    const msteams = { ...card.msteams };
    if (fullWidth) msteams.width = "Full";
    if (entities.length) msteams.entities = [...(msteams.entities ?? []), ...entities];

    return { ...card, msteams };
};

/**
 * Wraps an Adaptive Card in the Teams message envelope.
 * @param {Object} card
 * @returns {Object} Message payload
 */
export const wrapCard = (card) => ({
    type: "message",
    attachments: [{ contentType: CARD_CONTENT_TYPE, contentUrl: null, content: card }],
});

/**
 * Builds the full request body from operation options.
 * @param {Object} options - Operation options
 * @returns {Object} Message payload
 */
export const buildPayload = (options = {}) => {
    const mode = clean(options.messageType) ?? "card";

    if (mode === "card") return wrapCard(buildCard(options));
    if (mode === "raw") return wrapCard(parseRawCard(options.cardJson, options));

    throw new Error("Message type must be either 'card' or 'raw'");
};

/**
 * Classifies a webhook URL without exposing it.
 * @param {string} url
 * @returns {"workflows" | "legacy" | "unknown"}
 */
export const detectEndpoint = (url) => {
    const { hostname, pathname } = new URL(url);
    if (/\.webhook\.office\.com$/i.test(hostname) || /^outlook\.office(365)?\.com$/i.test(hostname)) return "legacy";
    if (/(logic\.azure\.com|powerplatform\.com|powerautomate\.com)$/i.test(hostname) || pathname.includes("/workflows/")) {
        return "workflows";
    }
    return "unknown";
};
