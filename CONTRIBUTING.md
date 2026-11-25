# Contributing
Open an issue before anything larger than a small fix. Node.js 22; for the desktop app also stable Rust (and the WebKitGTK
packages on Linux, listed in the workflow).

    npm ci && npx playwright install chromium && npm run build && npm test && npx vitest run

One change per pull request, with a test. Files in `kit/` are copies shared by several apps: say what needs changing in an
issue instead of editing them. By sending a pull request you agree it is released under the MIT licence.
