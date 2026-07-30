# ONYX contract SDKs

The original IFEM v2.0 package supplies Rust and TypeScript representations of all 144 commands, all 150 events, and their canonical envelopes. Both SDKs are checked against `contracts/v2.0/manifests/package-manifest.json` by `npm run validate:artifact-package`.

Build and test from the repository root:

```sh
npm run check:artifacts
```

The Rust package has a committed lockfile, serializes canonical command/event names, uses the contract actor values, omits absent optional fields, and includes both command and event envelopes. The TypeScript package has an independent lockfile and emits JavaScript plus declarations into its ignored `dist` directory.
