### Added

- **`extension_names` names the employees who never place a call.** Set it as `101=Anna Smirnova,103=Vera Orlova`,
  or in `pbx office setup` and WireCat Desktop. Before, an extension got a name only from the caller ID of a call it
  placed, so `stats calls show` listed an employee who only answers as a bare number. A name set here wins. See
  [names of the extensions](../docs/installation.md#names-of-the-extensions).
- **FreePBX's own names of the extensions.** On a FreePBX MySQL, `pbx` reads `asterisk.users` with the same database
  user, the two columns `extension` and `name` only, so the admin grants access to those columns and never to the
  phones' passwords in the same table. A user without that grant syncs as before, with one note. The order:
  `extension_names`, then FreePBX, then the caller ID.

### Fixed

- **A sync no longer drops an extension's name from a call it reads again.** When the records read this time held no
  call that named the extension, the call kept no name for it; it now keeps the name it was saved with.
