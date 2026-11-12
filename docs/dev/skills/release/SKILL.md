---
name: release
description: Release this CLI — run release:check, write the changelog under the handbook's headings, check the docs against what changed, raise the version in a pull request, merge it and publish with bin/release from GitHub Actions. Use when asked to release, prepare a release, cut a version, «выпуск», «выпустить версию».
---

# Release

The rules are the handbook's [Releases page](../../../../node_modules/@wirecat/cli-base/docs/standards/releases.md)
(`WC-REL-<n>`), which wins over this skill. An agent prepares the release, merges the release pull request and runs
`bin/release`, which publishes from GitHub Actions. Only the first release is the owner's, from this computer.

1. **What changed.** In a worktree off `origin/main`: `git log --oneline "$(git describe --tags --abbrev=0 origin/main)..origin/main"`. The
   `docs/commands.md` diff shows what a cli-core or cli-base release changed in the commands.
2. **The checks.** `pnpm release:check`. Before the version is raised, only the changelog's `## Unreleased` may be
   left; report anything else and fix it in the release pull request.
3. **The changelog.** Write `## Unreleased` under the handbook's headings, each at most once: `Added`,
   `Changed — may break callers`, `Fixed`, `Security`, `Removed` (`WC-DOC-14` to `WC-DOC-18`). No internal ids.
   The `changes/` fragments count too: `bin/release` collects them into the version's section.
4. **The docs.** `README.md`, `docs/*.md` and `skills/asterisk-cli/SKILL.md` state what the code does now (`WC-DOC-3`).
   `pnpm generate` and `pnpm test:matrix` rewrite the generated pages (`WC-DOC-4`).
5. **The comparison page.** Re-prove each ✅, 🟡 and ❌ this CLI has on its comparison page against the release build
   (`WC-CMP-11`): the site copy in cli-docs, `translations/pages/asterisk/compare.en.md` and its `.ru.md` and `.es.md`,
   or this repository's `docs/compare.md` where it keeps one. Update the check date and version in the intro, in the
   site repository, and name the page in the release pull request.
6. **The fresh audit.** Start a new subagent that has none of your context, and give it the prompt in
   [fresh-audit.md](fresh-audit.md) as written. Put its report in the release pull request. Fix each gap in this
   repository there, or list it as a follow-up; take a gap in the handbook to cli-base.
7. **The version.** `npm view @wirecat/asterisk-cli version` is what is published. The changelog picks the level, and
   before `1.0.0` this narrows `WC-REL-7`: a section with `Changed — may break callers` or `Removed` raises the minor
   (`0.1.8` to `0.2.0`), and so does one with `Added`; only a section of `Fixed`, `Security` or docs raises the patch.
   From `1.0.0`, a breaking change raises the major. `pnpm version:check` refuses a dated section whose number is
   raised less than its headings need, and when `bin/release` moves to the next free number on npm it raises that
   number to the level the headings need. Set the next version in `package.json`, run `pnpm version:sync`, date the
   section as `## <version> — DD.MM.YYYY`, run `pnpm release:check` again, and commit.
8. **The live check.** Run this CLI's live check of the real service on that commit, by the owner or with the
   owner's yes (`WC-TEST-18`). When it passes, `pnpm exec cli-dev live record --script <the script you ran>` appends
   the version, the commit, the date and a hash of the checked files to `docs/dev/live-checks.txt`; commit that line.
   `bin/release` refuses a version with no line, or whose `src/`, `package.json` or lockfile differ from the hashed
   ones (`WC-REL-17`). It needs no branch commit, so a fresh clone releases after the squash merge.
9. **The pull request.** Open `chore(release): <version>` with a `## Conformance` section: the `release:check`
   result, the live check's line, the fresh audit's report and the slice reviews' results. `release-pr.yml` fails a
   pull request that changes the version without one.
10. **The publish.** Merge it when its checks pass, then run `bin/release` on a clean `main`: it starts
   `release.yml` and follows it (`WC-REL-11`). A messenger CLI also needs the owner's yes for that version in the
   conversation (`WC-REL-10`): ask before you run `bin/release`. Never `bin/release --local`: that is the owner's, for the first release before npm trusts
   `release.yml`, with `NPM_TOKEN`, the npm token in the keyring, or the owner's own npm login.
   The keyring is read only when `NPM_KEYRING_ACCOUNT` names the account the token is stored under (service `npm`);
   there is no default account. When that lookup fails, `bin/release` stops; it does not fall back to the npm login.
