# Microsoft Teams Operation

Send messages to Microsoft Teams channels and chats from your Directus Flows as Adaptive Cards, using a Teams Workflows webhook.

## Features

- Send through a **Teams Workflows** webhook (older Incoming Webhook URLs still work)
- **Simple card**: title, message, colour, image, facts and up to 5 link buttons
- **Custom card**: paste your own Adaptive Card JSON
- **Mentions** with `<at>Name</at>`
- Works with Directus template values such as `{{$trigger.payload.title}}`

## Configuration

A new operation only shows the essentials:

- **Webhook URL**: the Workflows webhook URL from Teams
- **Title**: e.g. `New article: {{$trigger.payload.title}}`
- **Message**: the card text; Markdown is supported

Turn on **More options** for colour, full width, image, buttons, facts, mentions and custom Adaptive Card JSON.

Example **Facts** and **Buttons** values:

```json
[{ "title": "Status", "value": "{{$trigger.payload.status}}" }]
```

```json
[{ "title": "Open in Directus", "url": "https://cms.example.com/admin/content/articles/{{$trigger.key}}" }]
```

## Teams Setup

Microsoft is retiring Office 365 Connectors (the classic Incoming Webhook), so use the Workflows app:

1. In Teams, open the channel, select **More options (…)** → **Workflows**.
2. Choose the template **Send webhook alerts to a channel**.
3. Pick the team and channel, select **Save** and copy the webhook link.

## Requirements

- Directus 10.10 or later

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Security Considerations

- The webhook URL contains a signature: anyone who has it can post to your channel. Treat it like a password and recreate the workflow if it leaks.
- The URL is never shown in the flow overview, error messages or results.

## Error Handling

- If Teams rejects the request, the operation fails with the reason and the flow continues on its reject path.
- Teams Workflows accepts a message before posting it. If a card is invalid, the error appears in the workflow's run history in Teams, not in Directus.
- Teams rejects messages over about 28 KB and limits each webhook to about 4 messages per second.
