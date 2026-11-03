# Flow Version History

See who changed a Directus Flow, when, and what exactly changed, with before and after values for every edit.

## Features

- **Timeline of changes**: e.g. "Jane changed the step 'Send email' · 2 hours ago (changed: URL, method)"
- **Before / After**: the changed values of each edit
- **Show flow at this point**: the flow's steps as they were at that time
- **Compare with current**: how that version differs from the flow today
- **Export**: the history as JSON or CSV

## Usage

Once installed, enable the module in your Project Settings and open **Flow Version History** from the module bar.

1. The most recently edited flow is selected automatically. Pick another flow from the dropdown.
2. Click a change in the timeline to see what changed.
3. Use **Show flow at this point** or **Compare with current** for the bigger picture.

## Requirements

- Directus 10.10 or later
- An administrator account
- Activity and revision retention long enough to cover the history you want to see

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. It only reads Directus' own activity and revision history and never restores or changes flows. Webhook URLs, tokens and passwords are hidden in the history and in exports.

## Limitations

- Directus saves flow and step edits separately. Steps are matched to their flow from the saved history and, for older edits, by time.
- Deleted steps keep no snapshot in Directus, so their old values may be missing.
- Older history may be removed by your retention settings.
