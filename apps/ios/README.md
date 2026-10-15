# Lakeside Ops

The Lakeside Games studio operations app for iPhone and iPad. Native SwiftUI,
iOS 17 and later.

- **Keir**: a private thread with Keir, the studio's operator. Live task
  status, decisions you can approve or reject, charts.
- **Pulse**: what needs attention, service uptime, operator activity, host load
  and recent alerts.
- **Desk**: open support tickets with fix stages, and the workers on them.
- **Work**: the product board by live lane.
- **Notifications**: replies, time-sensitive decisions with approve and reject
  on the lock screen, and quiet incident alerts.

The app talks only to `ops.lakesidegames.net` with the signed-in staff session.
Credentials stay in the device Keychain, requests are pinned to HTTPS and never
follow redirects. Access is restricted server-side.

## Building

Requires Xcode 26 and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
swift scripts/icons.swift
xcodegen generate
bash scripts/simulator.sh LakesideOps   # build and run the UI and session tests
```

UI tests run against built-in fixtures (`--uitest-fixtures`) and never contact
a server.

## Releases

GitHub Actions builds and tests every pull request on a macOS runner. A manual
run of **Lakeside Ops iOS** with `release` checked signs the app and uploads it
to TestFlight using the repository's App Store Connect secrets
(`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_CONTENT`,
`APPLE_DEVELOPMENT_TEAM`). Signing output is filtered before it reaches the log.

## License

Source available, not open source. See [LICENSE.md](LICENSE.md).
