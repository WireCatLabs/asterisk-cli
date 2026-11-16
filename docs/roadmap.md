# Roadmap

This page lists what is planned for `pbx` and not done yet. Read it before you build a workaround for a missing
feature: it may already be on the way. The order can change, and there are no dates. To suggest something, open an
[issue on GitHub](https://github.com/WireCatLabs/asterisk-cli/issues).

## What works today

`pbx` reads the call records of an Asterisk PBX from `Master.csv`, or from a MySQL, MariaDB or PostgreSQL CDR
table in a read-only session, also through the phone system's SSH when the database listens only there. It reads the
files from this computer, a mounted folder, or the PBX over SFTP with a pinned server key. It keeps each call in the
local WireCat store with its caller and the employees who placed or answered it, links it to its recording, and turns
recordings into text on your computer, or with OpenAI when you turn that on for a profile. You and your agent count
the calls, search them by words and by meaning, mark them, and list, read and export them with no network, over the
command line or MCP. See [install and connect](installation.md).

## Later

- Find missed calls and calls in one direction with a filter on `meetings list`.
- Read Asterisk's CEL log (channel event logging), where transfers and queues are exact.

## What it will not do

`pbx` stays read-only against the PBX. It will not change the PBX settings, place or end calls, or delete a
recording. A recording is never sent to a cloud service unless you turn that option on for the profile.

What changed in each released version is in the [changelog](../CHANGELOG.md).
