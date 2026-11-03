# Permission Simulator for Directus

See what any role or user can do in Directus without logging in as them. One table shows who can create, read, update and delete what, in plain language.

## Features

- **Access table**: every collection with Create / Read / Update / Delete shown as full access, some items only, or no access
- **Plain explanations**: click a collection to see which items and fields are allowed and which policy grants it
- **Check a specific item**: pick an item from a list and see whether it can be seen, edited or deleted
- **Compare two roles**: only the differences are shown
- **Export**: download the current view as JSON or CSV

## Usage

Once installed, enable the module in your Project Settings and open **Permission Simulator** from the module bar.

1. The first non-admin role is selected automatically. Use **View access as** to switch to another role or a user.
2. System collections are hidden; tick **Show system collections** to include them.
3. Click a row to see the details. Raw filters are under **Technical details**.
4. Use **Compare with…** in the header to compare with a second role, and **Export** to download the result.

_Simulating a role has no logged-in user, so rules that use `$CURRENT_USER` are marked "Depends on who is logged in". Pick a user to see the real result._

## Requirements

- Directus 11 or later (uses access policies)
- An administrator account

## Installation

Refer to the official guides for installing the extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions).

## Permissions

The module and its API are available to administrators only. Simulating is read-only: nothing is created, updated or deleted.

Directus policies are additive. When several rules apply to the same collection and action, Directus combines them, and the simulator shows the combined result.

## Limitations

- Policies with IP allowlists are evaluated using your own IP address.
- The extension uses internal Directus permission helpers, so test it again after each major Directus upgrade.
