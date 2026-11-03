/**
 * Microsoft Teams Operation API Handler
 *
 * Server-side logic that posts an Adaptive Card to Microsoft Teams through a
 * Workflows (Power Automate) webhook URL or a legacy Incoming Webhook URL.
 *
 * The webhook URL carries a signature, so it is never logged or returned.
 */

import { MAX_PAYLOAD_BYTES, buildPayload, clean, detectEndpoint } from "./payload.js";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_ERROR_TEXT = 500;

/**
 * Validates the webhook URL
 * @param {unknown} value - Webhook URL option
 * @returns {string} Trimmed URL
 * @throws {Error} If missing or not an https URL
 */
const validateWebhookUrl = (value) => {
    const url = clean(value);
    if (!url) throw new Error("Webhook URL is required and cannot be empty");

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error("Webhook URL is not a valid URL");
    }
    if (parsed.protocol !== "https:") throw new Error("Webhook URL must use https");

    return url;
};

/**
 * Reads the response text, truncated and with the webhook URL scrubbed
 * @param {Response} response
 * @param {string} url - Webhook URL to redact
 * @returns {Promise<string>}
 */
const readErrorText = async (response, url) => {
    let text = "";
    try {
        text = (await response.text()).trim();
    } catch {
        return "";
    }
    text = text.split(url).join("[redacted]");
    return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}…` : text;
};

/**
 * Sends the payload to the Teams webhook
 * @param {string} url - Webhook URL
 * @param {string} body - JSON body
 * @returns {Promise<Response>}
 * @throws {Error} On network failure, timeout or non-2xx response
 */
const sendTeamsMessage = async (url, body) => {
    let response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        // Never echo the original error: some runtimes include the URL in it
        if (error?.name === "TimeoutError" || error?.name === "AbortError") {
            throw new Error(`Request to the Teams webhook timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        }
        const code = error?.cause?.code ? ` (${error.cause.code})` : "";
        throw new Error(`Network error: failed to reach the Teams webhook${code}`);
    }

    if (!response.ok) {
        const text = await readErrorText(response, url);
        const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
        throw new Error(`Teams webhook responded with ${status}${text ? `: ${text}` : ""}`);
    }

    return response;
};

/**
 * Main handler function for processing Teams message operations
 * This is the entry point called by Directus when the operation executes.
 * Options arrive already rendered by Directus' mustache templating.
 */
// Plain object (same shape as defineOperationApi) so zod from the SDK is not bundled
export default {
    id: "teams",
    handler: async (options, context = {}) => {
        try {
            const url = validateWebhookUrl(options?.webhookUrl);
            const endpoint = detectEndpoint(url);

            if (endpoint === "legacy") {
                context.logger?.warn(
                    "Teams operation: legacy Incoming Webhook (Microsoft 365 Connector) URLs are being retired. Switch to a Workflows webhook URL."
                );
            }

            const payload = buildPayload(options);
            const body = JSON.stringify(payload);
            const size = Buffer.byteLength(body, "utf8");

            if (size > MAX_PAYLOAD_BYTES) {
                throw new Error(
                    `Message is ${(size / 1024).toFixed(1)} KB, Teams accepts at most ${MAX_PAYLOAD_BYTES / 1024} KB`
                );
            }

            const response = await sendTeamsMessage(url, body);

            return {
                ok: true,
                status: response.status,
                endpoint,
                type: clean(options.messageType) ?? "card",
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            // Wrap and rethrow so Directus flows can route to the reject path
            throw new Error(`Failed to send Teams message: ${error.message}`);
        }
    },
};
