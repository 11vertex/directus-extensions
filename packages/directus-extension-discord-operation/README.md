# Discord Operation

Send messages and rich embeds to Discord channels or threads from your Directus Flows, using a webhook or a Discord bot.

## Features

- Send with a **webhook** (simplest) or a **bot token**
- **Plain messages** in text or Markdown, with Directus template values such as `{{$trigger.payload.id}}`
- **Rich embeds**: title, description, colour (Basic, Success, Error, Info), author, images, footer, timestamp and fields

## Configuration

A new operation only shows the essentials:

- **Send with**: Webhook or Discord bot. Pick this first; the fields below change with it.
- **Webhook URL / Channel ID**: the webhook URL, or the channel or thread ID in bot mode
- **Bot token**: bot mode only
- **Message**: e.g. `New order {{$trigger.payload.id}} was placed`

Turn on **More options** to send an embed and set its colour, images, timestamp, footer and author. Embed fields go under **Advanced: custom JSON**:

```json
[
  { "name": "Status", "value": "Paid", "inline": true },
  { "name": "Total", "value": "€42.00", "inline": true }
]
```

Discord allows up to 25 fields per embed; `name` and `value` are required.

## Discord Setup

**Webhook**

1. In Discord, open the channel settings → **Integrations** → **Webhooks**.
2. Create a webhook and click **Copy Webhook URL**.

**Bot**

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and add a bot. Copy its token.
2. Under **OAuth2 → URL Generator**, choose the `bot` scope with the **Send Messages** and **Embed Links** permissions, open the generated URL and add the bot to your server.
3. Turn on Developer Mode in Discord (User Settings → Advanced), right-click the channel or thread and choose **Copy ID**.

## Requirements

- Directus 10.10 or later

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Security Considerations

- Treat the webhook URL and bot token like passwords: anyone who has them can post to your server.
- The bot token is stored as a password field, and neither it nor the webhook URL is shown in the flow overview.

## Troubleshooting

- **Nothing arrives**: check the webhook URL or bot token, and that the bot can post in that channel.
- **Embed missing**: the bot needs the **Embed Links** permission; check the fields JSON and image URLs.
- **Older flows**: flows saved with earlier versions keep working; hidden options keep their values.
