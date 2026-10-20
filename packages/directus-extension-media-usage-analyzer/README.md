# Media Usage Analyzer

Find unused and duplicate files, broken file links and large images in your Directus project, see where your storage goes, and clean up safely.

## Features

- **Storage used**: total size, file count and your largest files
- **Unused files**: files that no field points to, with safe batch delete
- **Duplicates**: groups of likely duplicate uploads and the space they waste
- **Broken links**: fields that point to files that no longer exist
- **Large images**: images over 4000 px on a side or over 10 MB
- **Storage by type**: images, video, documents and other
- **Export**: the full report as CSV or JSON

## Usage

Once installed, enable the module in your Project Settings and open **Media Usage Analyzer** from the module bar.

1. A scan starts right away and shows a card for each report. The card most worth acting on is marked **Start here**.
2. Click a card to see its files, each with a thumbnail and an **Open** link.
3. To clean up, select unused files and click **Delete selected**, then confirm.

To also find files linked inside text and JSON fields (e.g. `/assets/<id>` in a WYSIWYG field), tick **Also check links inside text fields (slower)** and click **Scan again**.

## Requirements

- Directus 10.10 or later
- An administrator account

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. Scans are read-only.

Deleting is the only change the extension makes. Before deleting, the server checks every selected file again and skips any file that is now in use. Deleted files are removed from storage too and appear in the activity log under your name. Deleting cannot be undone.

## Limitations

- Only links Directus knows about are detected. Files used by external websites, flows, presets, dashboards or custom code appear as unused, so review the list before deleting.
- Directus stores no file checksum, so duplicates are matched by file size, name and type.
- Scanning text fields on large projects can take a while.
