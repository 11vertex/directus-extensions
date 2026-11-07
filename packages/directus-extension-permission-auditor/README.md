# Permission Auditor for Directus

Scan every policy and permission in your Directus project for risky access, with a plain explanation and a fix for each finding.

## Features

- **One verdict**: e.g. "3 problems to fix, 5 to review" or "No problems found", with a count per group
- **Grouped findings**: Fix now, Worth reviewing and Good to know. Pick a group in the sidebar to show just that one
- **How to fix**: every finding explains why it matters and has a button to open the policy
- **Export**: download the report as JSON or CSV

## What it checks

| Group | Examples |
| --- | --- |
| Fix now | Public access with admin rights; public users can create, update or delete; public read access; deleting without any filter; write access to roles, policies or settings |
| Worth reviewing | Admin policy without required 2FA; all fields writable; fields that look like secrets are readable |
| Good to know | Policies nobody uses; policies that grant nothing; duplicate rules; who has admin access |

These are hints, not proof of a vulnerability. Review each finding before changing anything.

## Usage

Once installed, enable the module in your Project Settings and open **Permission Auditor** from the module bar. The audit runs straight away. Use **Show** in the sidebar to look at one group, the refresh button in the header to run it again, and the download button to export the report.

## Requirements

- Directus 11 or later (uses access policies)
- An administrator account

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. The audit is read-only and never changes policies or permissions.
