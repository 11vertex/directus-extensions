# Flow Debugger for Directus

See every run of your Directus Flows, find out which step failed and why, and compare a failed run with the last one that worked.

## Features

- **Recent runs**: newest first, with worked / failed status, time and who or what started it
- **Step timeline**: each step with its input and output
- **Clear failures**: "Failed at step 'Send email': …" with that step opened automatically
- **Compare with last successful run**: lists what changed in plain sentences
- **Export**: the selected run or the list as JSON or CSV

## Usage

Once installed, enable the module in your Project Settings and open **Flow Debugger** from the module bar.

1. The latest run is shown right away. Pick a flow or switch to **Failed only** to narrow the list.
2. Click a run to see its steps, and **Show data** on a step to see its input and output.
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

- Directus records a run only after it finishes, so there is no live view of running flows.
- Directus does not store how long a run or step took.
- Sensitive values are hidden by Directus before they are saved.
- Older runs may be removed by your retention settings (`FLOW_LOGS_RETENTION`).
