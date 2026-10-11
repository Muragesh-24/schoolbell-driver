import { useEffect, useRef, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin, Location, CallbackError } from "@capacitor-community/background-geolocation";

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

const SERVER = "http://20.164.0.74:3000";

type Screen = "home" | "tracking" | "error";

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [token, setToken] = useState("");
  const [routeName, setRouteName] = useState("");
  const [lastPing, setLastPing] = useState<string | null>(null);
  const [pings, setPings] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const watcherId = useRef<string | null>(null);

  async function startTracking() {
    const t = token.trim();
    if (!t) return;

    // Verify token with server first
    try {
      const res = await fetch(`${SERVER}/api/bus/route?token=${encodeURIComponent(t)}`);
      if (!res.ok) throw new Error("Route not found or inactive. Check your token.");
      const data = await res.json();
      setRouteName(data.name ?? t);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Could not connect to server");
      setScreen("error");
      return;
    }

    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: "Schoolbell is tracking your bus location.",
        backgroundTitle: "Bus Tracking Active",
        requestPermissions: true,
        stale: false,
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
              lat: location.latitude,
              lng: location.longitude,
              accuracy: location.accuracy,
            }),
          });
          setLastPing(new Date().toLocaleTimeString());
          setPings((n) => n + 1);
        } catch {
          // network blip — keep going
        }
      },
    );

    watcherId.current = id;
    setScreen("tracking");
  }

  async function stopTracking() {
    if (watcherId.current) {
      await BackgroundGeolocation.removeWatcher({ id: watcherId.current });
      watcherId.current = null;
    }
    setPings(0);
    setLastPing(null);
    setScreen("home");
  }

  useEffect(() => {
    return () => {
      if (watcherId.current) {
        BackgroundGeolocation.removeWatcher({ id: watcherId.current });
      }
    };
  }, []);

  return (
    <div style={styles.container}>
      {screen === "home" && (
        <div style={styles.card}>
          <div style={styles.logo}>🔔</div>
          <h1 style={styles.title}>Schoolbell Driver</h1>
          <p style={styles.subtitle}>Enter your bus token to start tracking</p>
          <input
            style={styles.input}
            placeholder="Paste bus token here"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            style={{ ...styles.btn, ...styles.btnPrimary, opacity: token.trim() ? 1 : 0.5 }}
            onClick={startTracking}
            disabled={!token.trim()}
          >
            Start Tracking
          </button>
          <p style={styles.hint}>
            Get your token from the headmaster's Bus Tracking page.
          </p>
        </div>
      )}

      {screen === "tracking" && (
        <div style={styles.card}>
          <div style={styles.pulseOuter}>
            <div style={styles.pulseInner} />
          </div>
          <h1 style={styles.title}>{routeName}</h1>
          <p style={{ ...styles.subtitle, color: "#16a34a", fontWeight: 600 }}>
            Broadcasting location
          </p>
          <div style={styles.infoBox}>
            <p style={styles.infoText}>{pings} update{pings !== 1 ? "s" : ""} sent</p>
            {lastPing && <p style={styles.infoText}>Last ping: {lastPing}</p>}
          </div>
          <div style={styles.successBox}>
            <p style={styles.successText}>
              ✅ Tracking continues in background even when screen is off
            </p>
          </div>
          <button style={{ ...styles.btn, ...styles.btnDanger }} onClick={stopTracking}>
            Stop Tracking
          </button>
        </div>
      )}

      {screen === "error" && (
        <div style={styles.card}>
          <div style={styles.logo}>⚠️</div>
          <h1 style={{ ...styles.title, color: "#ef4444" }}>Error</h1>
          <p style={styles.subtitle}>{errorMsg}</p>
          <button
            style={{ ...styles.btn, ...styles.btnSecondary }}
            onClick={() => { setErrorMsg(""); setScreen("home"); }}
          >
            Go back
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#f8fafc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: 32,
    width: "100%",
    maxWidth: 360,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  },
  logo: { fontSize: 48 },
  pulseOuter: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "#dcfce7",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pulseInner: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "#22c55e",
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0, textAlign: "center" },
  subtitle: { fontSize: 14, color: "#64748b", margin: 0, textAlign: "center" },
  input: {
    width: "100%",
    border: "1.5px solid #e2e8f0",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
    letterSpacing: 1,
  },
  btn: {
    width: "100%",
    padding: "14px 0",
    borderRadius: 12,
    border: "none",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnPrimary: { background: "#4f46e5", color: "#fff" },
  btnDanger: { background: "#fee2e2", color: "#dc2626" },
  btnSecondary: { background: "#f1f5f9", color: "#334155" },
  infoBox: {
    background: "#f0fdf4",
    borderRadius: 10,
    padding: "10px 16px",
    width: "100%",
  },
  infoText: { fontSize: 13, color: "#166534", margin: "2px 0" },
  successBox: {
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    borderRadius: 10,
    padding: "10px 16px",
    width: "100%",
  },
  successText: { fontSize: 12, color: "#15803d", margin: 0, textAlign: "center" },
  hint: { fontSize: 12, color: "#94a3b8", textAlign: "center" },
};

export default App;
