/**
 * Star Map shell: the whole sky experience is the bundled web page
 * (Stellarium Web Engine + our UI) in a full-screen WebView. This screen adds
 * what a web page can't do well on iOS:
 *  - true-north CoreMotion orientation (native StarMotion module, 60 Hz)
 *  - real haptics, GPS location, and keeping the screen awake
 * Messages: page → app via postMessage; app → page via window.__starmap.onNative.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Share, StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { CameraView, Camera } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { StarMotion } from "../../modules/star-motion";

const bundleDir = Paths.bundle.uri.replace(/\/?$/, "/");
const SKY_DIR = bundleDir + "sky/";
const SKY_URL = SKY_DIR + "index.html";

type PageMessage =
  | { type: "haptic"; style: "light" | "medium" | "success" | "selection" }
  | { type: "ready" }
  | { type: "sensor-mode"; on: boolean }
  | { type: "log"; text: string }
  | { type: "telescope-connect"; protocol: string; host: string; port: number }
  | { type: "telescope-goto"; ra: number; dec: number }
  | { type: "telescope-disconnect" }
  | { type: "camera"; on: boolean }
  | { type: "share"; dataUrl: string; message: string }
  | { type: "notify-schedule"; id: string; at: number; title: string; body: string; data: { mjd?: number; target?: string } }
  | { type: "notify-cancel"; id?: string; prefix?: string };

// Show alerts (ISS in 5 minutes…) even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Ask once per launch at most; iOS only shows the system prompt the first time. */
let notifyAllowed: Promise<boolean> | null = null;
function allowNotifications() {
  notifyAllowed ??= Notifications.getPermissionsAsync()
    .then((p) => (p.granted ? p : Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })))
    .then((p) => p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL)
    .catch(() => false);
  return notifyAllowed;
}

/** Run notification calls in order (a cancel-all must finish before the reschedule). */
let notifyChain: Promise<unknown> = Promise.resolve();
const inOrder = (fn: () => Promise<unknown>) => (notifyChain = notifyChain.then(fn).catch((err) => StarMotion.log(`notify: ${err}`)));

export default function Sky() {
  useKeepAwake();
  const web = useRef<WebView>(null);
  /** AR mode: live camera preview under a see-through WebView. */
  const [camera, setCamera] = useState(false);
  const motionSub = useRef<{ remove(): void } | null>(null);

  /** Call into the page (fast path, no React state). */
  const send = useCallback((msg: object) => {
    web.current?.injectJavaScript(`window.__starmap&&window.__starmap.onNative(${JSON.stringify(msg)});true;`);
  }, []);

  /** Resolves once the location prompt is answered; true-north motion needs it. */
  const locationGranted = useRef<Promise<boolean> | null>(null);
  const askLocation = useCallback(() => {
    locationGranted.current ??= Location.requestForegroundPermissionsAsync()
      .then((r) => r.status === "granted")
      .catch(() => false);
    return locationGranted.current;
  }, []);

  const sendLocation = useCallback(async () => {
    try {
      if (!(await askLocation())) return;
      const last = await Location.getLastKnownPositionAsync();
      if (last) send({ type: "location", lat: last.coords.latitude, lon: last.coords.longitude, alt: last.coords.altitude ?? 0 });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      send({ type: "location", lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude ?? 0 });
    } catch {
      /* the page falls back to its saved or default location */
    }
  }, [send, askLocation]);

  const setMotion = useCallback(
    async (on: boolean) => {
      motionSub.current?.remove();
      motionSub.current = null;
      StarMotion.stop();
      if (!on || !StarMotion.isAvailable()) return;
      const trueNorth = await askLocation();
      if (!trueNorth) send({ type: "north", magnetic: true });
      // Round to keep the injected JS small; 4 decimals is ~0.006°.
      const r = (x: number) => Math.round(x * 1e4) / 1e4;
      let warned = false;
      motionSub.current =
        StarMotion.addListener((e) => {
          send({ type: "motion", m: e.m.map((row) => row.map(r)) });
          // CMMagneticFieldCalibrationAccuracy: -1 = uncalibrated.
          if (e.acc === -1 && !warned) {
            warned = true;
            send({ type: "calibrate" });
          }
        }) ?? null;
      StarMotion.start(60, trueNorth);
    },
    [send, askLocation],
  );

  // Tapped notifications: forward to the page (it jumps to that time and object).
  const pageReady = useRef(false);
  const pendingOpen = useRef<object | null>(null);
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      const data = r?.notification.request.content.data;
      if (!data) return;
      if (pageReady.current) send({ type: "notify-open", data });
      else pendingOpen.current = data;
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [send]);

  useEffect(() => {
    // Telescope state and position, straight through to the page.
    const sub = StarMotion.onTelescope((e) => send({ type: "telescope", ...e }));
    return () => {
      sub?.remove();
      motionSub.current?.remove();
      StarMotion.stop();
      StarMotion.telescopeDisconnect();
    };
  }, [send]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: PageMessage;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        pageReady.current = true;
        send({ type: "caps", motion: StarMotion.isAvailable() });
        sendLocation();
        if (pendingOpen.current) {
          send({ type: "notify-open", data: pendingOpen.current });
          pendingOpen.current = null;
        }
      }
      if (msg.type === "share") {
        // iOS shares a base64 data URL as an image. Image only: with a message
        // too, the sheet previews the text instead of the picture (the
        // snapshot carries its own caption strip).
        Share.share({ url: msg.dataUrl }).catch((err) => StarMotion.log(`share: ${err}`));
      }
      if (msg.type === "camera") {
        if (!msg.on) {
          setCamera(false);
          send({ type: "camera-state", on: false });
        } else {
          Camera.requestCameraPermissionsAsync()
            .then((p) => {
              setCamera(p.granted);
              // The page flips to transparent once the preview is up (onCameraReady).
              if (!p.granted) send({ type: "camera-state", on: false, denied: true });
            })
            .catch(() => send({ type: "camera-state", on: false, denied: true }));
        }
      }
      if (msg.type === "notify-schedule") {
        inOrder(async () => {
          if (!(await allowNotifications())) return send({ type: "notify-permission", granted: false });
          await Notifications.scheduleNotificationAsync({
            identifier: msg.id,
            content: { title: msg.title, body: msg.body, data: msg.data, sound: true },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(msg.at) },
          });
        });
      }
      if (msg.type === "notify-cancel") {
        const { id, prefix } = msg;
        inOrder(async () => {
          if (id) await Notifications.cancelScheduledNotificationAsync(id);
          if (prefix) {
            const all = await Notifications.getAllScheduledNotificationsAsync();
            await Promise.all(all.filter((n) => n.identifier.startsWith(prefix)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
          }
        });
      }
      if (msg.type === "log") StarMotion.log(msg.text);
      if (msg.type === "telescope-connect") StarMotion.telescopeConnect(msg.host, msg.port, msg.protocol);
      if (msg.type === "telescope-goto") StarMotion.telescopeGoto(msg.ra, msg.dec);
      if (msg.type === "telescope-disconnect") StarMotion.telescopeDisconnect();
      if (msg.type === "sensor-mode") setMotion(msg.on);
      if (msg.type === "haptic") {
        if (msg.style === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        else if (msg.style === "selection") Haptics.selectionAsync();
        else Haptics.impactAsync(msg.style === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [send, sendLocation, setMotion],
  );

  return (
    <View style={[styles.root, camera && styles.clear]}>
      <StatusBar style="light" />
      {camera && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={false}
          onCameraReady={() => send({ type: "camera-state", on: true })}
          onMountError={() => {
            setCamera(false);
            send({ type: "camera-state", on: false });
          }}
        />
      )}
      <WebView
        ref={web}
        source={{ uri: SKY_URL }}
        originWhitelist={["*"]}
        allowingReadAccessToURL={SKY_DIR}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={onMessage}
        // Links (About, Wikipedia, credits) open in Safari; the page itself never navigates away.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url.startsWith("file:") || req.url.startsWith("about:") || req.url.startsWith("blob:") || req.url.startsWith("data:")) return true;
          if (req.navigationType === "click" || /^(https?|mailto|itms-apps):/.test(req.url)) {
            Linking.openURL(req.url).catch(() => {});
            return false;
          }
          return true;
        }}
        // iOS kills the web content process under memory pressure (often
        // while the app is in the background). Without this the sky stays
        // blank until the app is force-quit.
        onContentProcessDidTerminate={() => {
          StarMotion.log("web content process terminated, reloading");
          motionSub.current?.remove();
          motionSub.current = null;
          StarMotion.stop();
          web.current?.reload();
        }}
        style={camera ? styles.clear : styles.web}
        containerStyle={camera ? styles.clear : styles.web}
        bounces={false}
        scrollEnabled={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsInlineMediaPlayback
        // Native feel: no web-form toolbar above the keyboard, no link previews.
        hideKeyboardAccessoryView
        // Search opens with the keyboard up, like a native search screen.
        keyboardDisplayRequiresUserAction={false}
        allowsLinkPreview={false}
        textInteractionEnabled
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
  clear: { flex: 1, backgroundColor: "transparent" },
});
