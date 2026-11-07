# Activity & Revisions Cleanup Manager for Directus

See how much history (activity and revisions) each collection keeps, check whether Directus' automatic cleanup is turned on, and clean up the history of a single collection.

## Features

- **Status at a glance**: the sidebar shows e.g. "History uses 1.2 GB (850,000 records)" and whether automatic cleanup is on
- **How to turn it on**: the exact settings to add when automatic cleanup is off
- **History by collection**: record counts and the oldest record, including history of deleted collections
- **Clean up one collection**: delete its history older than 30 days, 90 days, 1 year, or all of it
- **Export**: the overview as CSV or JSON

## Usage

Once installed, enable the module in your Project Settings and open **Activity Cleanup** from the module bar.

1. The sidebar shows whether automatic cleanup is on and how much history there is. If it is off, **How to turn it on** shows the settings to add.
2. The table lists each collection's history. Click **Clean up** on the one you want.
3. Choose how old the history must be. The dialog shows how many records will be deleted; confirm to delete them.

When cleanup is on, the sidebar button shows the current **Retention settings**.

## Configuration

Directus can clean up old history automatically. This extension shows these settings but does not change them; set them in your environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RETENTION_ENABLED` | `false` | Turns the automatic cleanup on |
| `RETENTION_SCHEDULE` | `0 0 * * *` | When the cleanup runs (cron) |
| `ACTIVITY_RETENTION` | `90d` | How long activity is kept |
| `REVISIONS_RETENTION` | `90d` | How long revisions are kept |
| `FLOW_LOGS_RETENTION` | `90d` | How long flow run logs are kept |

Use this extension when you need more control than that, for example to clean up a single collection now.

## Requirements

- Directus 10.10 or later
- An administrator account

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. Viewing is read-only.

Cleaning up deletes history permanently and cannot be undone. It only affects the collection you pick; your content items are never touched. Every cleanup shows a preview first, and history that belongs to a content version is always kept.

## Limitations

- Table sizes are shown on PostgreSQL only; other databases show record counts.
- After a large cleanup on PostgreSQL, run `VACUUM` during maintenance to return disk space to the system.
