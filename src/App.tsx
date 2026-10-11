import { useEffect, useRef, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin, Location, CallbackError } from "@capacitor-community/background-geolocation";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

const SERVER = "https://schoolbelldemo.engigrow.dev";

type Screen = "setup" | "tracking" | "error";

// ── Battery optimisation helper ───────────────────────────────────────────────
// Tries the Android battery-settings deep-link; silently ignores on iOS/browser.
function openBatterySettings() {
  try {
    // Capacitor WebView on Android passes custom scheme intents via window.open
    window.open("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", "_system");
  } catch { /* ignore */ }
}

// ── Setup checklist item ──────────────────────────────────────────────────────
function CheckItem({
  done,
  label,
  sub,
  onFix,
  fixLabel,
}: {
  done: boolean;
  label: string;
  sub: string;
  onFix?: () => void;
  fixLabel?: string;
}) {
  return (
    <div style={styles.checkRow}>
      <div style={{ ...styles.checkIcon, background: done ? "#22c55e" : "#f59e0b" }}>
        <span style={{ fontSize: 14 }}>{done ? "✓" : "!"}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={styles.checkLabel}>{label}</p>
        <p style={styles.checkSub}>{sub}</p>
      </div>
      {!done && onFix && (
        <button style={styles.fixBtn} onClick={onFix}>
          {fixLabel ?? "Fix"}
        </button>
      )}
    </div>
  );
}

// ── Pulse ring animation injected once ───────────────────────────────────────
function injectPulse() {
  if (document.getElementById("sb-pulse")) return;
  const s = document.createElement("style");
  s.id = "sb-pulse";
  s.textContent = `
    @keyframes sb-ring { 0%,100%{transform:scale(1);opacity:.5} 50%{transform:scale(1.7);opacity:0} }
    @keyframes sb-ring2 { 0%,100%{transform:scale(1);opacity:.3} 50%{transform:scale(2.2);opacity:0} }
    .sb-r1{animation:sb-ring 2s infinite}
    .sb-r2{animation:sb-ring2 2s .4s infinite}
  `;
  document.head.appendChild(s);
}

// ── Main component ────────────────────────────────────────────────────────────
function App() {
  const [screen, setScreen]       = useState<Screen>("setup");
  const [token, setToken]         = useState("");
  const [routeName, setRouteName] = useState("");
  const [lastPing, setLastPing]   = useState<string | null>(null);
  const [pings, setPings]         = useState(0);
  const [errorMsg, setErrorMsg]   = useState("");
  const [notifOk, setNotifOk]     = useState(false);
  const [connecting, setConnecting] = useState(false);
  const watcherId  = useRef<string | null>(null);
  const wakeLock   = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    injectPulse();
    // Check notification permission state on mount
    if ("Notification" in window) {
      setNotifOk(Notification.permission === "granted");
    } else {
      setNotifOk(true); // native handles it
    }
  }, []);

  async function requestNotif() {
    if ("Notification" in window) {
      const r = await Notification.requestPermission();
      setNotifOk(r === "granted");
    }
  }

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock.current = await (navigator as Navigator & { wakeLock: { request: (t: string) => Promise<WakeLockSentinel> } }).wakeLock.request("screen");
      }
    } catch { /* not supported */ }
  }

  async function startTracking() {
    const t = token.trim();
    if (!t) return;
    setConnecting(true);

    if ("Notification" in window && Notification.permission === "default") {
      await requestNotif();
    }

    // Verify token
    try {
      const res = await fetch(`${SERVER}/api/bus/route?token=${encodeURIComponent(t)}`);
      if (!res.ok) throw new Error("Route not found or inactive. Check your token.");
      const data = await res.json();
      setRouteName(data.name ?? t);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Could not connect to server");
      setScreen("error");
      setConnecting(false);
      return;
    }

    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: "Schoolbell is broadcasting your bus location to parents.",
        backgroundTitle:   "🚌 Bus Tracking Active",
        requestPermissions: true,
        stale:  false,
        distanceFilter: 10,
      },
      async (location?: Location, error?: CallbackError) => {
        if (error) {
          if (error.code === "NOT_AUTHORIZED") {
            setErrorMsg("Location permission denied. Please allow in settings.");
            setScreen("error");
          }
          return;
        }
        if (!location) return;

        try {
          await fetch(`${SERVER}/api/bus/location`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: t,
              lat:      location.latitude,
              lng:      location.longitude,
              accuracy: location.accuracy,
            }),
          });
          setLastPing(new Date().toLocaleTimeString());
          setPings((n) => n + 1);
        } catch { /* network blip */ }
      },
    );

    watcherId.current = id;
    await acquireWakeLock();
    setConnecting(false);
    setScreen("tracking");
  }

  async function stopTracking() {
    if (watcherId.current) {
      await BackgroundGeolocation.removeWatcher({ id: watcherId.current });
      watcherId.current = null;
    }
    try { wakeLock.current?.release(); } catch { /* ignore */ }
    wakeLock.current = null;
    setPings(0);
    setLastPing(null);
    setScreen("setup");
  }

  useEffect(() => {
    return () => {
      if (watcherId.current) BackgroundGeolocation.removeWatcher({ id: watcherId.current });
      try { wakeLock.current?.release(); } catch { /* ignore */ }
    };
  }, []);

  // ── Setup screen ────────────────────────────────────────────────────────────
  if (screen === "setup") {
    return (
      <div style={styles.page}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoRing}>
            <span style={{ fontSize: 28 }}>🚌</span>
          </div>
          <p style={styles.appName}>SCHOOLBELL DRIVER</p>
          <p style={styles.appSub}>Location Tracking</p>
        </div>

        {/* Token input */}
        <div style={styles.section}>
          <p style={styles.sectionLabel}>BUS TOKEN</p>
          <input
            style={styles.input}
            placeholder="Paste your token here"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <p style={styles.hint}>Get token from Headmaster → Bus Tracking page</p>
        </div>

        {/* Pre-start checklist */}
        <div style={styles.section}>
          <p style={styles.sectionLabel}>SETUP CHECKLIST</p>
          <div style={styles.checkCard}>
            <CheckItem
              done={notifOk}
              label="Notifications"
              sub={notifOk ? "Permission granted — foreground service will show" : "Required to keep GPS running in background"}
              onFix={requestNotif}
              fixLabel="Allow"
            />
            <div style={styles.divider} />
            <CheckItem
              done={false}
              label="Battery — Unrestricted"
              sub="Android kills GPS when battery is optimised. Must be set manually."
              onFix={openBatterySettings}
              fixLabel="Open Settings"
            />
          </div>
          <p style={styles.batteryNote}>
            In Battery Settings: find Schoolbell Driver → Battery → select <strong>"Unrestricted"</strong>
          </p>
        </div>

        {/* Start button */}
        <button
          style={{
            ...styles.bigBtn,
            opacity: token.trim() && !connecting ? 1 : 0.5,
            background: "linear-gradient(135deg, #6366f1, #4f46e5)",
          }}
          onClick={startTracking}
          disabled={!token.trim() || connecting}
        >
          {connecting ? "Connecting…" : "Start Tracking"}
        </button>
      </div>
    );
  }

  // ── Error screen ─────────────────────────────────────────────────────────────
  if (screen === "error") {
    return (
      <div style={styles.page}>
        <div style={styles.errorCard}>
          <span style={{ fontSize: 40 }}>⚠️</span>
          <p style={{ ...styles.appName, color: "#ef4444", marginTop: 12 }}>Error</p>
          <p style={{ fontSize: 14, color: "#94a3b8", marginTop: 8, textAlign: "center", lineHeight: 1.6 }}>{errorMsg}</p>
          <button style={{ ...styles.bigBtn, marginTop: 24, background: "#1e293b" }}
            onClick={() => { setErrorMsg(""); setScreen("setup"); }}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // ── Tracking screen ───────────────────────────────────────────────────────────
  return (
    <div style={styles.trackPage}>
      {/* Status bar notification card */}
      <div style={styles.notifCard}>
        <div style={styles.notifIcon}>
          <span style={{ fontSize: 16 }}>🚌</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={styles.notifTitle}>Bus Tracking Active</p>
          <p style={styles.notifBody}>
            {pings > 0
              ? `${pings} update${pings !== 1 ? "s" : ""} sent · Last: ${lastPing}`
              : "Waiting for GPS fix…"}
          </p>
        </div>
        <div style={styles.notifDot} />
      </div>

      {/* Pulse animation */}
      <div style={styles.pulseWrap}>
        <div className="sb-r2" style={styles.ring2} />
        <div className="sb-r1" style={styles.ring1} />
        <div style={styles.pulseCore}>
          <span style={{ fontSize: 32 }}>🚌</span>
        </div>
      </div>

      {/* Route name */}
      <p style={styles.routeName}>{routeName}</p>
      <p style={styles.routeSub}>
        {pings > 0 ? "Broadcasting to parents" : "Acquiring GPS signal…"}
      </p>

      {/* Stats row */}
      <div style={styles.statsRow}>
        <div style={styles.statBox}>
          <p style={styles.statVal}>{pings}</p>
          <p style={styles.statLabel}>Updates</p>
        </div>
        <div style={styles.statBox}>
          <p style={styles.statVal}>{lastPing ?? "—"}</p>
          <p style={styles.statLabel}>Last ping</p>
        </div>
      </div>

      {/* Background note */}
      <div style={styles.bgNote}>
        <p style={styles.bgNoteText}>
          🔋 Keep screen on or ensure Battery is set to <strong>Unrestricted</strong> in Settings so GPS runs when screen is off.
        </p>
      </div>

      <button style={{ ...styles.bigBtn, background: "#1e293b", color: "#f87171", marginTop: "auto" }}
        onClick={stopTracking}>
        Stop Tracking
      </button>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0f172a",
    display: "flex",
    flexDirection: "column",
    padding: "48px 24px 32px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    gap: 24,
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  logoRing: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 32px rgba(79,70,229,0.4)",
  },
  appName: {
    fontSize: 18,
    fontWeight: 800,
    color: "#f1f5f9",
    letterSpacing: 3,
    margin: 0,
  },
  appSub: {
    fontSize: 12,
    color: "#64748b",
    margin: 0,
    letterSpacing: 1,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#475569",
    letterSpacing: 2,
    margin: 0,
  },
  input: {
    background: "#1e293b",
    border: "1.5px solid #334155",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 14,
    color: "#f1f5f9",
    outline: "none",
    letterSpacing: 1,
    fontFamily: "monospace",
    boxSizing: "border-box",
    width: "100%",
  },
  hint: {
    fontSize: 11,
    color: "#475569",
    margin: 0,
    textAlign: "center",
  },
  checkCard: {
    background: "#1e293b",
    borderRadius: 16,
    padding: "4px 16px",
    border: "1px solid #334155",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 0",
  },
  checkIcon: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 700,
    flexShrink: 0,
  },
  checkLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#e2e8f0",
    margin: 0,
  },
  checkSub: {
    fontSize: 11,
    color: "#64748b",
    margin: "2px 0 0",
    lineHeight: 1.4,
  },
  fixBtn: {
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
  },
  divider: {
    height: 1,
    background: "#334155",
    marginLeft: 40,
  },
  batteryNote: {
    fontSize: 11,
    color: "#64748b",
    margin: 0,
    textAlign: "center",
    lineHeight: 1.5,
  },
  bigBtn: {
    width: "100%",
    padding: "16px",
    borderRadius: 14,
    border: "none",
    fontSize: 15,
    fontWeight: 700,
    color: "#fff",
    cursor: "pointer",
    letterSpacing: 0.5,
    boxSizing: "border-box",
  },
  errorCard: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  // Tracking screen
  trackPage: {
    minHeight: "100vh",
    background: "#0f172a",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "24px 24px 40px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    gap: 0,
    boxSizing: "border-box",
  },
  notifCard: {
    width: "100%",
    background: "#1e293b",
    borderRadius: 16,
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    border: "1px solid #334155",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  },
  notifIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#f1f5f9",
    margin: 0,
  },
  notifBody: {
    fontSize: 11,
    color: "#64748b",
    margin: "2px 0 0",
  },
  notifDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22c55e",
    flexShrink: 0,
    boxShadow: "0 0 8px #22c55e",
  },
  pulseWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 160,
    height: 160,
    marginTop: 48,
  },
  ring2: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: "50%",
    background: "rgba(79,70,229,0.12)",
  },
  ring1: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: "50%",
    background: "rgba(79,70,229,0.18)",
  },
  pulseCore: {
    position: "relative",
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 32px rgba(79,70,229,0.5)",
  },
  routeName: {
    fontSize: 22,
    fontWeight: 800,
    color: "#f1f5f9",
    margin: "24px 0 4px",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  routeSub: {
    fontSize: 13,
    color: "#22c55e",
    fontWeight: 600,
    margin: 0,
    letterSpacing: 0.3,
  },
  statsRow: {
    display: "flex",
    gap: 12,
    marginTop: 28,
    width: "100%",
  },
  statBox: {
    flex: 1,
    background: "#1e293b",
    borderRadius: 14,
    padding: "16px 12px",
    textAlign: "center",
    border: "1px solid #334155",
  },
  statVal: {
    fontSize: 20,
    fontWeight: 800,
    color: "#f1f5f9",
    margin: 0,
    fontVariantNumeric: "tabular-nums",
  },
  statLabel: {
    fontSize: 11,
    color: "#475569",
    margin: "4px 0 0",
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: "uppercase" as const,
  },
  bgNote: {
    width: "100%",
    background: "#1e293b",
    borderRadius: 12,
    padding: "12px 14px",
    marginTop: 20,
    border: "1px solid #f59e0b44",
  },
  bgNoteText: {
    fontSize: 11,
    color: "#94a3b8",
    margin: 0,
    lineHeight: 1.6,
    textAlign: "center",
  },
};

// Add WakeLockSentinel type if not available
declare global {
  interface WakeLockSentinel {
    release: () => Promise<void>;
  }
}

export default App;
