# Content Dependency Graph

See how your Directus collections and items are connected, check what deleting an item would do before you delete it, and find content that nothing uses.

## Features

- **Connections in plain sentences**: e.g. "Articles uses: Author (one from Users)" and "Articles is used by: Comments → Article", with a small map of direct neighbours
- **Delete impact**: pick an item and see what would happen, e.g. "3 comments will also be deleted · Blocked: 2 invoices still point to it"
- **Health check**: items nothing uses, empty required links, links to deleted items, circular links and collections that aren't connected to anything
- **Full map**: every collection, with pan and zoom
- **Export**: the map as SVG, JSON or a Mermaid diagram

## Usage

Once installed, enable the module in your Project Settings and open **Content Dependency Graph** from the module bar.

1. Pick a collection on the left (the most connected one opens automatically) to see what it uses and what uses it.
2. Click **Check an item**, pick an item, and see what deleting it would do.
3. Use **Health check** in the header for a list of problems, or **Show full map** for the whole picture.

System collections are hidden unless you tick **Show system collections**.

## Requirements

- Directus 10.10 or later
- An administrator account

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. It is read-only and never creates, updates or deletes anything.

## Limitations

- The delete check follows your database relation rules. Hooks or flows that run on delete can do more than it shows.
- On very large tables the health check can take a moment.
