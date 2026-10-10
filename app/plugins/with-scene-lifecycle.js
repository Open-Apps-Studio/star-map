/**
 * Expo config plugin: adopt the UIScene life cycle, which iOS 27 requires
 * (apps built with the iOS 27 SDK assert at launch without it:
 * "_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption").
 *
 * Expo SDK 57 ships `ExpoAppSceneDelegate` (objc name EXExpoAppSceneDelegate)
 * but the prebuild template doesn't use it yet. This plugin:
 *  1. registers it in Info.plist (UIApplicationSceneManifest)
 *  2. makes AppDelegate an ExpoReactNativeFactoryProvider and stops it from
 *     creating its own window (the scene delegate creates the window and
 *     starts React Native in it).
 */
const { withInfoPlist, withAppDelegate } = require("expo/config-plugins");

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "EXExpoAppSceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });

  config = withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") throw new Error("with-scene-lifecycle expects a Swift AppDelegate");
    let src = cfg.modResults.contents;
    if (!src.includes("ExpoReactNativeFactoryProvider")) {
      src = src.replace("class AppDelegate: ExpoAppDelegate {", "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {");
      // Drop the template's own window + startReactNative block.
      const start = src.indexOf("#if os(iOS) || os(tvOS)\n    window = UIWindow");
      const end = start >= 0 ? src.indexOf("#endif", start) : -1;
      if (start < 0 || end < 0) throw new Error("with-scene-lifecycle: AppDelegate template changed, update the plugin");
      src = src.slice(0, start) + "// The scene delegate (EXExpoAppSceneDelegate) creates the window and starts React Native.\n" + src.slice(end + "#endif".length);
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
};
