/**
 * Star Map shell: the whole sky experience is the bundled web page
 * (Stellarium Web Engine + our UI) in a full-screen WebView. This screen adds
 * what a web page can't do well on iOS:
 *  - true-north CoreMotion orientation (native StarMotion module, 60 Hz)
 *  - real haptics, GPS location, and keeping the screen awake
 * Messages: page → app via postMessage; app → page via window.__starmap.onNative.
 */
import { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { StarMotion } from "../../modules/star-motion";

const bundleDir = Paths.bundle.uri.replace(/\/?$/, "/");
const SKY_DIR = bundleDir + "sky/";
const SKY_URL = SKY_DIR + "index.html";

type PageMessage =
  | { type: "haptic"; style: "light" | "medium" | "success" | "selection" }
  | { type: "ready" }
  | { type: "sensor-mode"; on: boolean };

export default function Sky() {
  useKeepAwake();
  const web = useRef<WebView>(null);
  const motionSub = useRef<{ remove(): void } | null>(null);

  /** Call into the page (fast path, no React state). */
  const send = useCallback((msg: object) => {
    web.current?.injectJavaScript(`window.__starmap&&window.__starmap.onNative(${JSON.stringify(msg)});true;`);
  }, []);

  const sendLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const last = await Location.getLastKnownPositionAsync();
      if (last) send({ type: "location", lat: last.coords.latitude, lon: last.coords.longitude, alt: last.coords.altitude ?? 0 });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      send({ type: "location", lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude ?? 0 });
    } catch {
      /* the page falls back to its saved or default location */
    }
  }, [send]);

  const setMotion = useCallback(
    (on: boolean) => {
      motionSub.current?.remove();
      motionSub.current = null;
      StarMotion.stop();
      if (!on || !StarMotion.isAvailable()) return;
      // Round to keep the injected JS small; 4 decimals is ~0.006°.
      const r = (x: number) => Math.round(x * 1e4) / 1e4;
      motionSub.current = StarMotion.addListener((e) => send({ type: "motion", m: e.m.map((row) => row.map(r)) })) ?? null;
      StarMotion.start(60);
    },
    [send],
  );

  useEffect(() => () => setMotion(false), [setMotion]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: PageMessage;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === "ready") sendLocation();
      if (msg.type === "sensor-mode") setMotion(msg.on);
      if (msg.type === "haptic") {
        if (msg.style === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        else if (msg.style === "selection") Haptics.selectionAsync();
        else Haptics.impactAsync(msg.style === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [sendLocation, setMotion],
  );

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <WebView
        ref={web}
        source={{ uri: SKY_URL }}
        originWhitelist={["*"]}
        allowingReadAccessToURL={SKY_DIR}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={onMessage}
        style={styles.web}
        containerStyle={styles.web}
        bounces={false}
        scrollEnabled={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsInlineMediaPlayback
        javaScriptEnabled
        webviewDebuggingEnabled={__DEV__}
        // Dark until the page paints, so there's no white flash.
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#05070d" },
  web: { flex: 1, backgroundColor: "#05070d" },
});
