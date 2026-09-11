# zenwit Validation

Validated locally on macOS on 2026-09-11:

- Stable and Beta TypeScript checks and complete unit suites.
- Market type checks and tests.
- Desktop build and variant alignment; vendored runtime integrity.
- Windows NSIS patch reversal regression, corrected by removing the redundant `--directory=.` argument that prevented the include filter from matching.
- Isolated Electron Beta first launch, skipping the optional setup wizard, main conversation, settings and model-provider page, restart with the same test data, title and brand marks.
- Model settings at a 900 x 640 viewport without horizontal overflow.
- No credentials supplied or model requests sent during the UI smoke. Remote access was left off.

Local screenshots are in `/tmp/zenwit-product-check/`. They are temporary validation evidence, not release assets. The test application was closed after inspection.

Remaining release checks require separate environments or inputs: real model credentials for successful responses and tool execution; signed/notarized macOS and Windows installer verification on target systems; a deployed zenwit update service and actual distributor contact details. The source archive has no root Git repository, so Git-index-based documentation and architecture checks still need an initialized repository. No remote, commit or public release was created.
