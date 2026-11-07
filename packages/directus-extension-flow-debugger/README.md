# Flow Debugger for Directus

See every run of your Directus Flows, find out which step failed and why, and compare a failed run with the last one that worked.

## Features

- **Recent runs**: newest first in the sidebar, for the flow you pick, with worked / failed status, time and who or what started it
- **The run on the flow**: your flow drawn like the flow editor, with the steps that ran marked as worked or failed and the steps that never ran greyed out
- **Clear failures**: "Failed at 'Send email': …" with the failed step outlined in red
- **Step details**: click any step to see what it received and what it returned
- **Compare with last successful run**: lists what changed in plain sentences and outlines the steps that differ
- **Export**: the selected run or the list as JSON or CSV

## Usage

Once installed, enable the module in your Project Settings and open **Flow Debugger** from the module bar.

1. Pick a flow in the sidebar (the one you used last is remembered for you) and switch to **Failed** to narrow the list. The latest run opens right away.
2. Click a run to see it drawn on the flow, and click a step to see its input and output.
3. Click **Compare with last successful run** to see what was different.

## Configuration

Directus only saves step details for flows whose **Activity & Logs** setting is **All**. Open the flow's settings and change it if a run shows no steps.

## Requirements

- Directus 10.10 or later
- An administrator account

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. The debugger is read-only: it never re-runs, retries or changes flows.

## Limitations

- The picture uses the flow as it is today. Steps added after a run are left out, and steps removed after a run are not drawn; the page notes both. Positions and connections are today's.
- Directus records a run only after it finishes, so there is no live view of running flows.
- Directus does not store how long a run or step took.
- Sensitive values are hidden by Directus before they are saved.
- Older runs may be removed by your retention settings (`FLOW_LOGS_RETENTION`).
