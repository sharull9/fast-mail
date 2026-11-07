# Mailfast settings

## Purpose and approved scope

Mailfast needs one place to customize shortcuts, account details, appearance, and recipient recommendations. The user approved a settings page and clarified that contacts mean the email recommendations extracted by the app, with support for adding addresses manually.

Account edits and contact edits stay inside Mailfast. Google supplies account identity and mail access. This change does not edit Google profiles or Google Contacts.

## Page and navigation

Add an authenticated `/settings` route inside the existing app layout. Add a Settings entry to the account menu and command menu. Keep the mailbox sidebar available and provide a Back to mail link.

The page has five sections: Appearance, Keyboard shortcuts, Accounts, Contacts, and Mail data. A validated `section` search parameter selects a section and supports direct links. Appearance is the default. Desktop uses a narrow section navigation beside the content. Mobile stacks section navigation above the content.

Use the existing typography, spacing, buttons, form controls, and feedback patterns. Forms show validation beside the affected field. Account and contact forms use explicit Save and Cancel actions. Theme choices and shortcut edits apply immediately and show save errors when persistence fails.

## Appearance

Provide Light, Dark, and System choices. Keep Dark as the default for existing installations so the change preserves their current appearance. System follows `prefers-color-scheme` and responds to changes while the app is open.

Theme preferences belong to the current browser or desktop installation and persist across restarts. Apply the saved theme before the first visible render. Add complete light-theme tokens for the workspace, sidebar, popovers, composer, and forms. Verify that mail bodies remain readable in both themes.

## Keyboard shortcuts

Show the existing shortcut catalog grouped by Navigation, Actions, Selection, Search, and Accounts. Each row shows the action, its current binding, Change, Disable, and Reset. Provide Restore all defaults with confirmation.

Use the installed TanStack Hotkeys recorder and custom-hotkey APIs. A recording captures one chord. Escape cancels recording. Disable explicitly clears a binding. Reset removes an override and restores the default. A conflict identifies the action already using the chord and prevents saving it. Detect conflicts against effective bindings, including defaults and custom bindings.

Persist validated overrides in browser-local storage. Restore them before registering shortcuts. Unknown shortcut IDs and malformed saved values do not prevent startup. Recover with valid entries or defaults and show a settings notice.

All registrations, tooltips, menu hints, and the existing shortcut reference dialog use the effective bindings. `shortcutLabel` currently reads `defaultHotkey`; update its consumers so hints react to edits. Keep the existing rules that pause mail actions while typing or recording. Mail-list shortcuts do not run on the settings page. Test shifted symbols and physical-key handling after remapping, including the current trash shortcut.

## Accounts

List connected accounts with their Google email, avatar, active status, and local account name. Users can change the local account name and a plain-text signature for each account. Google email and Google profile identity remain read-only. The local name appears in Mailfast's account controls and does not change the sender identity on outgoing mail.

Reuse the existing add-account, switch-account, and sign-out flows. Reconnect starts the existing Google sign-in flow for an account that needs authentication. Destructive sign-out controls explain that the local cache is removed and ask for confirmation.

Store local account names and signatures in that account's SQLite `kv` store. Server responses merge the saved name into the account details exposed to the interface. Signing out follows the existing account-store cleanup behavior and removes these local settings with the cache.

Insert the account's signature once when a new draft, reply, or forward is created. Treat the signature as text and escape it when constructing HTML. Users can edit or delete the inserted text. Changing a saved signature does not rewrite open drafts, and sending does not append it again.

## Contacts and recipient recommendations

The Contacts section edits the same per-account recommendations used by To, Cc, Bcc, and email mentions in the composer. It shows extracted addresses and manually added addresses in one searchable list. Support adding an email and optional name, editing an entry, and removing it from recommendations.

Validate email addresses and name lengths on both client and server. Normalize surrounding whitespace and compare email addresses case-insensitively. Adding an existing email updates its manual details instead of creating a duplicate.

Preserve manually edited names when later mail syncs extract a different name. Removing an extracted recommendation hides it so background sync cannot recreate it immediately. Provide a Show removed filter with a Restore action. Editing an email hides the old recommendation and creates or updates the replacement in one transaction.

Extend the existing contacts table with a nullable manual-name override and a hidden flag through a Drizzle migration. Keep extracted names and frequency data. A non-null manual name wins over the extracted name, including an explicitly empty name. Automatic contact upserts update extracted fields while preserving manual edits and the hidden flag.

Keep `/api/contacts` as the composer suggestion endpoint, excluding hidden entries. Add authenticated, account-scoped endpoints to list and save recommendations and to hide or restore them. Management listing uses bounded pagination and a search query so large mailboxes do not load every contact at once. Invalidate composer contact results after edits.

Remove built-in sample contacts from production suggestions. Stop writing new recommendations to the unscoped browser fallback. On the first Contacts visit, migrate real entries saved under `mailfast.local-contacts` once into the active account, excluding built-in sample entries. Preserve the old browser data until the import succeeds, and record which account received the migration. Offline suggestion caching stays scoped to the account and respects removals.

## Mail data

Expose the existing Import mail dialog in Settings and explain where to export messages and selected conversations. Reuse the implemented EML and MBOX handlers, limits, and result feedback. Keep the existing message and conversation export controls available.

## Persistence and boundaries

Browser-local storage holds device preferences: theme and custom shortcuts. Per-account SQLite stores hold account names, signatures, and recommendations. This makes appearance and keyboard choices independent of account switching while sharing account data between paired clients using the same Mailfast server.

Use shared Zod schemas for settings and contact request bodies. Server routes use the existing authorization gate and resolve the account from the existing account header. A request for one account cannot read or modify another account's settings. Bound strings, page sizes, and migration batches. Render names and signatures as text, with escaping when HTML is required.

Reuse TanStack Query for server state and the existing account event flow for account details. Add account-tagged events for contact or account-setting changes so paired clients refresh affected data. A failed save leaves the form available with its unsaved values and an actionable error. Storage failures do not display a successful save.

## Alternatives and choice

Keeping all settings in browser storage avoids server work but loses shared account recommendations and makes paired clients disagree about account names and signatures. Putting every preference on the server makes keyboard and theme choices follow users across devices with different needs. The selected split uses browser storage for device preferences and the existing per-account database for account data.

Google profile and Google Contacts integration would require a separate product decision, additional API behavior, and potentially more OAuth permissions. The approved scope uses the recommendations Mailfast already extracts.

## Verification and acceptance

- Settings opens through its route, account menu, and command menu, and returns to mail on desktop and mobile.
- Remapped shortcuts work immediately and after restart. Old bindings stop working, conflicts cannot be saved, and visible hints match the active bindings.
- Recording, typing in settings, and using dialogs do not trigger mail actions. Reset and Disable work for individual shortcuts and the full catalog.
- Light, Dark, and System cover the app controls and mail view. Saved appearance loads without a theme flash, and System reacts to operating-system changes.
- Account names and signatures stay isolated by account. A signature appears once per new draft and survives editing without duplication.
- Manual contact additions appear in recipient and mention suggestions. Edited names survive sync. Removed addresses stay hidden after sync and restart and return only after restoration.
- Invalid requests, case-insensitive duplicates, account isolation, browser-contact migration, pagination, and save failures have focused server or database tests.
- Browser tests cover settings navigation, shortcut recording and restart persistence, theme switching, account edits, and manual contact creation through recipient selection.
- Run the relevant type checks, changed-file formatting and lint checks, database and server tests, and focused browser tests. Report existing unrelated failures separately.

## Implementation boundary

This document defines the approved product scope and proposed design. Product code is unchanged by this document. The next artifact is an implementation plan after review of this written spec.
