/**
 * Expo config plugin: copy ./sky (the built sky page + Stellarium data) into
 * the iOS app bundle as a folder, so the WebView can load it from file://.
 * Implemented as a Run Script build phase, which keeps the folder structure
 * intact without adding hundreds of files to the Xcode project.
 */
const { withXcodeProject } = require("expo/config-plugins");

const PHASE_NAME = "Copy sky bundle";

module.exports = function withSkyBundle(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
    const exists = Object.values(phases).some((p) => p && p.name === `"${PHASE_NAME}"`);
    if (!exists) {
      project.addBuildPhase([], "PBXShellScriptBuildPhase", PHASE_NAME, project.getFirstTarget().uuid, {
        shellPath: "/bin/sh",
        shellScript: [
          'set -e',
          'SRC="$PROJECT_DIR/../sky"',
          'DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/sky"',
          'if [ ! -f "$SRC/index.html" ]; then echo "error: sky/ missing, run scripts/sync-web.sh"; exit 1; fi',
          'rm -rf "$DEST" && mkdir -p "$DEST"',
          'rsync -a "$SRC/" "$DEST/"',
        ].join("\n"),
      });
    }
    return cfg;
  });
};
