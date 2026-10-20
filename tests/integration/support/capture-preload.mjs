// Loaded into the throwaway Directus process with `--import`.
// Outgoing requests to Discord / Slack / Teams never leave the machine: they are recorded
// by the test capture server and answered with a realistic fake response.

const CAPTURE_URL = process.env.DX_CAPTURE_URL;
const realFetch = globalThis.fetch;

const FAKE_RESPONSES = [
  { match: (url) => url.hostname === "discord.com" && url.pathname.startsWith("/api/webhooks/"), reply: () => new Response(null, { status: 204 }) },
  { match: (url) => url.hostname === "discord.com", reply: () => Response.json({ id: "1000000000000000001" }) },
  { match: (url) => url.hostname === "hooks.slack.com", reply: () => new Response("ok", { status: 200 }) },
  { match: (url) => url.hostname === "slack.com", reply: () => Response.json({ ok: true, ts: "1700000000.000100", channel: "C0TEST" }) },
  { match: (url) => url.hostname.endsWith(".logic.azure.com") || url.hostname.endsWith(".webhook.office.com"), reply: () => new Response(null, { status: 202 }) }
];

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const fake = FAKE_RESPONSES.find((entry) => entry.match(url));
  if (!fake || !CAPTURE_URL) return realFetch(input, init);

  await realFetch(CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: url.href,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers ?? {})),
      body: typeof init.body === "string" ? init.body : null
    })
  });

  return fake.reply();
};
