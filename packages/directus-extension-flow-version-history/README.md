# Flow Version History for Directus

See who changed a Directus Flow, when, and what exactly changed, with before and after values for every edit.

## Features

- **One row per version**: each press of Save in the flow editor is one version, shown in the sidebar with small pills (Added, Removed, Changed, Rearranged, Reverted) and the kinds of step it touched
- **The flow as it was**: every version is drawn like the flow editor, with the steps this version touched outlined
- **Before / After**: switch between the flow just before a change and the flow after it
- **Restore this version**: put the flow back to how it was at that point, including steps you removed since. The restore is saved as a new version, so you can undo it
- **Export**: the history as JSON or CSV

## Usage

Once installed, enable the module in your Project Settings and open **Flow Version History** from the module bar.

1. Pick a flow in the sidebar. The flow you used last is remembered for you.
2. Click a version to see the flow after that change, or switch to **Before** to see it just before.
3. To go back, pick the version you want and click **Restore this version**, then confirm.

## Requirements

- Directus 10.10 or later
- An administrator account
- Activity and revision retention long enough to cover the history you want to see

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. It reads Directus' own activity and revision history. The only thing it changes is a flow you choose to restore. Webhook URLs, tokens and passwords are hidden in the history and in exports, but a restore puts back the real stored values.

## Limitations

- Directus saves flow and step edits separately. Steps are matched to their flow from the saved history and, for older edits, by time.
- Deleted steps keep no snapshot in Directus, so their old values may be missing.
- Directus does not record how steps are connected when a step is created through the API, only when the connection is edited afterwards (which is what the flow editor does). A restore can therefore miss a connection that was never edited after its step was created.
- Older history may be removed by your retention settings.
