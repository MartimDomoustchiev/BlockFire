# BLOCKFIRE for Android and iPhone

The same game as the browser version, in a native app shell ([Capacitor](https://capacitorjs.com)).
The game's files are not changed for the apps: `npm run sync` copies them from the folder above into `www/`,
and the native projects load that copy.

## What you need

- Node 18 or newer
- For iPhone: Xcode 16 or newer (the iOS 15+ simulator and a Mac to run it)
- For Android: JDK 21 and the Android SDK (platform 36, build-tools 36.0.0), or Android Studio

## Build and run

```
cd native
npm install
npm run sync            # copy the game into www/ (run again after every change to the game)
npm run ios             # sync, then open the project in Xcode: pick an iPhone and press Run
npm run android         # sync, then open the project in Android Studio and press Run
npm run build:android   # a debug APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## What is different from the browser version

The game checks `window.__phoneApp` (set by `scripts/sync-www.js`) and then:

- hides the FULL SCREEN button and the "start in full screen" setting (the apps are full screen already);
- does not register the offline service worker (the files come with the app, so a cached copy could go stale).

Everything else is the same code: the lobby, the story, online play (PeerJS needs the internet, as in the browser) and touch controls.

## Changes inside the generated projects

`npx cap add android` and `npx cap add ios` make the projects in `android/` and `ios/`. These are the changes made
by hand to them. Do not run `cap add` again without copying them back:

- `android/app/src/main/java/local/blockfire/game/MainActivity.java`: full screen (the bars come back on a swipe), the
  screen stays on, the notch is used.
- `android/app/src/main/AndroidManifest.xml`: `screenOrientation="sensorLandscape"`.
- `ios/App/App/Info.plist`: landscape only on iPhone; export compliance answered (no custom encryption).
- `ios/App/App/AppDelegate.swift`: `BlockfireViewController`, which hides the status bar.
- `ios/App/App/Base.lproj/Main.storyboard`: the main view controller is `BlockfireViewController`.
- Icons and splash screens: the Quiet Order's emblem, drawn by `mac/make-icons.js` into `resources/icon.png` (1024 px)
  and `resources/splash.png` (2732 px), then
  `npx @capacitor/assets generate --ios --android --iconBackgroundColor '#0c0b0a' --iconBackgroundColorDark '#0c0b0a' --splashBackgroundColor '#0c0b0a'`.
  After regenerating, build Android with `./gradlew clean assembleDebug` (Gradle can miss replaced images).

The app id is `local.blockfire.game`, the same as the Mac app. Change it in `capacitor.config.json` (and in the
Android and iOS projects) before publishing to the stores.

## Not done yet

- Signing: the debug APK is signed by the debug key. A release build needs your own keystore (Android) and
  Apple developer team (iPhone, for a device or the App Store).
- Testing on real phones. The iPhone app was run in the iOS simulator; the Android app was built but not run.
