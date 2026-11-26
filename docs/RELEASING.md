# Releasing Breakwright
1. Bump the version in every file `kit/checks/agreement.test.ts` checks and write the changelog entry. Merge to `main`.
2. Try the CI build on Windows, macOS and Linux.
3. Push a tag `vX.Y.Z` (a suffix such as `-SNAPSHOT` makes a pre-release). CI puts the installers on a draft release; a maintainer publishes it.

There are no in-app updates yet: the window's page gets no native commands, so an update prompt has to come from the shell. The installers are unsigned.
