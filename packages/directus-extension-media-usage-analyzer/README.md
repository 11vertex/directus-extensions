# Media Usage Analyzer for Directus

Find unused and duplicate files, broken file links and large images in your Directus project, see where your storage goes, and clean up safely.

## Features

- **Storage**: total size, file count, storage by type and your largest files
- **Unused files**: files that no field points to, with safe batch delete
- **Duplicates**: groups of likely duplicate uploads and the space they waste
- **Broken links**: fields that point to files that no longer exist
- **Large images**: images over 4000 px on a side or over 10 MB
- **Export**: the full report as CSV or JSON

## Usage

Once installed, enable the module in your Project Settings and open **Media Usage Analyzer** from the module bar.

1. A scan starts right away and opens the **Overview**: one card each for Storage, Unused files, Duplicates, Broken links and Large images, with **Start here** on the one most worth acting on.
2. Click a card (or pick it in the sidebar) to see its files, each with a thumbnail and an **Open** link. Choose **Overview** in the sidebar to go back.
3. To clean up, open **Unused files**, select files and click **Delete selected**, then confirm.

To also find files linked inside text and JSON fields (e.g. `/assets/<id>` in a WYSIWYG field), tick **Also check links inside text fields** in the sidebar and click **Scan again** in the header.

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
