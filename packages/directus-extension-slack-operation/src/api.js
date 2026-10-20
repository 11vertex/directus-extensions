/**
 * Slack Operation API Handler
 *
 * Server-side logic for sending messages to Slack. Supports Incoming Webhooks
 * and the Web API (chat.postMessage) with a bot token. Payload building lives
 * in ./payload.js; this file only performs the HTTP request and maps results.
 */

import { buildSlackRequest } from "./payload.js";

/**
 * Reads a response body as JSON when possible, falling back to plain text
 * Incoming webhooks answer with plain text ("ok" or an error code)
 * @param {Response} response - Fetch response
 * @returns {Promise<{ json: Object|null, text: string }>}
 */
const readBody = async (response) => {
    const text = (await response.text()).trim();
    try {
        return { json: text ? JSON.parse(text) : null, text };
    } catch {
        return { json: null, text };
    }
};

/**
 * Posts a payload to Slack
 * Errors deliberately never include the request URL or headers, so the
 * webhook URL and bot token cannot leak into flow logs.
 * @param {Object} request - Request description from buildSlackRequest
 * @returns {Promise<Object>} Parsed JSON body (bot) or null (webhook)
 * @throws {Error} On network errors, non-2xx responses and `{ ok: false }` bodies
 */
const sendSlackMessage = async ({ url, headers, payload }) => {
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });
    } catch {
        throw new Error("Network error: Failed to connect to Slack");
    }

    const { json, text } = await readBody(response);

    if (!response.ok) {
        const detail = json?.error || text || response.statusText;
        throw new Error(`Slack API Error (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
    }

    // Web API answers HTTP 200 with { ok: false, error } on failure
    if (json && json.ok === false) {
        throw new Error(`Slack API Error: ${json.error || "unknown_error"}`);
    }

    return json;
};

/**
 * Main handler function for processing Slack message operations
 * This is the entry point called by Directus when the operation executes
 */
export default {
    id: "slack",
    handler: async (options) => {
        try {
            const request = buildSlackRequest(options);
            const result = await sendSlackMessage(request);

            if (request.integrationMethod === "webhook") {
                return { ok: true, integrationMethod: "webhook" };
            }

            return {
                ok: true,
                integrationMethod: "bot",
                ts: result?.ts,
                channel: result?.channel ?? request.payload.channel,
                threadTs: result?.message?.thread_ts ?? request.payload.thread_ts,
                ...(result?.warning && { warning: result.warning }),
            };
        } catch (error) {
            // Wrap and rethrow so Directus routes the flow to the reject path
            throw new Error(`Failed to send Slack message: ${error.message}`);
        }
    },
};
