import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Group, Peer, User } from "../shared/types";
import { api } from "./api";
import { AudioEngine } from "./AudioEngine";
import { Communications } from "./Communications";
import { Admin } from "./Admin";
import { ConnectDevice } from "./ConnectDevice";
import "./style.css";
type Listening = Record<string, { enabled: boolean; volume: number }>;
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [groups, setGroups] = useState<Group[]>([]),
    [peers, setPeers] = useState<Peer[]>([]),
    [status, setStatus] = useState("DISCONNECTED"),
    [ready, setReady] = useState(false),
    [micEnabled, setMicEnabled] = useState(false),
    [needsResume, setNeedsResume] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [connectOpen, setConnectOpen] = useState(false),
    [admin, setAdmin] = useState(false),
    [settings, setSettings] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [mic, setMic] = useState(""),
    [output, setOutput] = useState("");
  const [listen, setListen] = useState<Listening>({}),
    [latch, setLatch] = useState<string[]>([]),
    [held, setHeld] = useState<string[]>([]);
  const engine = useRef<AudioEngine | null>(null),
    comms = useRef<Communications | null>(null);
  const listenRef = useRef(listen);
  listenRef.current = listen;
  useEffect(() => {
    api<User>("/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    let stored: Listening = {};
    try {
      stored = JSON.parse(
        localStorage.getItem("mars-listen-" + user.id) ?? "{}",
      );
    } catch {}
    setListen(stored);
    const audio = new AudioEngine();
    engine.current = audio;
    audio.error = (s) => {
      setError(s);
      setLatch([]);
      setHeld([]);
      audio.silence();
      c.state([], c.listen);
    };
    const c = new Communications(audio);
    audio.interrupted = () => {
      setReady(false);
      setNeedsResume(true);
      setLatch([]);
      setHeld([]);
      audio.silence();
      c.state([], c.listen);
    };
    audio.recovered = () => {
      setReady(true);
      setNeedsResume(false);
    };
    comms.current = c;
    c.onStatus = setStatus;
    c.onReset = () => {
      setLatch([]);
      setHeld([]);
      setPeers([]);
    };
    c.onSnapshot = (m) => {
      setUser(m.user);
      setGroups(m.groups);
      const authorized = new Set(m.groups.map((g) => g.id));
      setLatch((previous) => previous.filter((g) => authorized.has(g)));
      setHeld((previous) => previous.filter((g) => authorized.has(g)));
      setPeers(m.peers);
      setListen((prev) =>
        Object.fromEntries(
          m.groups.map((g) => [
            g.id,
            prev[g.id] ?? { enabled: true, volume: 1 },
          ]),
        ),
      );
    };
    c.connect();
    return () => {
      c.close();
      audio.dispose();
      comms.current = null;
      engine.current = null;
      setReady(false);
      setMicEnabled(false);
      setNeedsResume(false);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    localStorage.setItem("mars-listen-" + user.id, JSON.stringify(listen));
    const allowed = new Set(groups.map((g) => g.id));
    comms.current?.state(
      ready
        ? [...new Set([...latch, ...held])].filter((g) => allowed.has(g))
        : [],
      Object.fromEntries(
        Object.entries(listen)
          .filter(([g]) => allowed.has(g))
          .map(([g, v]) => [g, v.enabled ? v.volume : 0]),
      ),
    );
  }, [listen, latch, held, ready, groups, user?.id]);
  useEffect(() => {
    const stop = () => {
      engine.current?.silence();
      setHeld([]);
      setLatch([]);
      comms.current?.state(
        [],
        Object.fromEntries(
          Object.entries(listenRef.current).map(([g, v]) => [
            g,
            v.enabled ? v.volume : 0,
          ]),
        ),
      );
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  async function enable(id?: string) {
    try {
      setError("");
      setLatch([]);
      setHeld([]);
      comms.current?.state([], comms.current.listen);
      await engine.current?.enable(id);
      engine.current?.setGain(user?.micGain ?? 1);
      setReady(true);
      setMicEnabled(true);
      setNeedsResume(false);
      setDevices(await navigator.mediaDevices.enumerateDevices());
      await comms.current?.sync();
    } catch (e) {
      setReady(false);
      if (engine.current?.capture) setNeedsResume(true);
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (!ready || !navigator.mediaDevices) return;
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then(setDevices);
    };
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [ready]);
  async function logout() {
    comms.current?.close();
    engine.current?.silence();
    try {
      await api("/logout", "POST");
    } finally {
      setUser(null);
      setGroups([]);
      setAdmin(false);
    }
  }
  if (loading)
    return (
      <main className="login">
        <p>Opening Mars Comms…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <div className="brand">
          MARS <span>COMMS</span>
          <small>LOCAL PRODUCTION INTERCOM</small>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              setUser(await api<User>("/login", "POST", Object.fromEntries(f)));
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="eyebrow">CREW ACCESS</div>
          <h1>Join the conversation.</h1>
          <p>Sign in to your production intercom.</p>
          <label>
            Username
            <input name="username" autoComplete="username" required autoFocus />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary wide">Sign in →</button>
        </form>
        <footer>On your network. In your control.</footer>
      </main>
    );
  const talking = [...new Set([...latch, ...held])];
  const connected = status === "CONNECTED";
  return (
    <>
      <header className="intercom-header">
        <div className="brand">
          MARS <span>COMMS</span>
        </div>
        <span className={"connection " + (connected ? "online" : "offline")}>
          ● {status}
        </span>
        <span
          className={"crew-count " + (connected ? "online" : "offline")}
          aria-label={`${peers.length + 1} crew online`}
          title={status}
        >
          <span aria-hidden="true">●</span> {peers.length + 1}
          <span className="crew-label"> online</span>
        </span>
        {needsResume && (
          <button
            className="primary resume-audio"
            onClick={() => void enable(mic || undefined)}
            title="Audio is paused or playback is blocked. Tap to resume."
          >
            Resume audio
          </button>
        )}
        <button
          className="qr-access"
          aria-label="Connect Device QR"
          onClick={() => setConnectOpen(true)}
        >
          QR
        </button>
        <button
          className="menu-toggle"
          aria-label="Application menu"
          aria-expanded={menuOpen}
          aria-controls="header-actions"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ☰
        </button>
        <div
          id="header-actions"
          className={"header-actions" + (menuOpen ? " open" : "")}
        >
          <button onClick={() => setSettings(true)}>Audio settings</button>
          {user.admin && (
            <button
              className={admin ? "selected" : ""}
              onClick={() => setAdmin(!admin)}
            >
              Admin
            </button>
          )}
          <span className="identity">{user.displayName}</span>
          <button onClick={() => void logout()}>Sign out</button>
        </div>
      </header>
      {connectOpen && <ConnectDevice onClose={() => setConnectOpen(false)} />}
      <main className="intercom-main">
        {user.defaultPassword && (
          <div className="warning">
            Default admin password is still active.{" "}
            <button onClick={() => setAdmin(true)}>
              Change password in Admin → Edit user
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {admin && user.admin ? (
          <Admin onClose={() => setAdmin(false)} onError={setError} />
        ) : (
          <>
            {!micEnabled && !needsResume && (
              <div className="audio-bar">
                <span>Enable your microphone to join audio</span>
                <button
                  className="primary"
                  onClick={() => void enable(mic || undefined)}
                >
                  Enable Microphone
                </button>
              </div>
            )}
            <div className="cards">
              {groups.map((g, index) => {
                const active = talking.includes(g.id) && connected;
                const speakers = peers.filter((p) => p.talk.includes(g.id));
                const l = listen[g.id] ?? { enabled: true, volume: 1 };
                return (
                  <article
                    className={
                      "card " +
                      (active
                        ? "transmitting"
                        : speakers.length
                          ? "receiving"
                          : "")
                    }
                    key={g.id}
                    style={{ "--group": g.color } as React.CSSProperties}
                  >
                    <div className="card-heading">
                      <span className="channel-index">
                        CH {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className={"tag " + (active ? "live" : "")}>
                        {active
                          ? "TRANSMITTING"
                          : speakers.length
                            ? "ON AIR"
                            : "STANDBY"}
                      </span>
                    </div>
                    <h2 title={g.name}>
                      <span className="dot" style={{ background: g.color }} />
                      <span className="channel-name">{g.name}</span>
                    </h2>
                    <div
                      className="speakers"
                      aria-live="polite"
                      title={[
                        ...(active ? ["You"] : []),
                        ...speakers.map((p) => p.user.displayName),
                      ].join(" · ")}
                    >
                      {active ? "You" + (speakers.length ? " · " : "") : ""}
                      {speakers.map((p) => p.user.displayName).join(" · ")}
                    </div>
                    <button
                      className={"listen " + (l.enabled ? "selected" : "")}
                      aria-pressed={l.enabled}
                      onClick={() =>
                        setListen((p) => ({
                          ...p,
                          [g.id]: { ...l, enabled: !l.enabled },
                        }))
                      }
                    >
                      ◖ Listen <span>{l.enabled ? "ON" : "OFF"}</span>
                    </button>
                    <button
                      className={"ptt " + (active ? "active" : "")}
                      disabled={!ready || !connected}
                      onContextMenu={(e) => e.preventDefault()}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setHeld((p) => [...new Set([...p, g.id])]);
                      }}
                      onPointerUp={(e) => {
                        e.preventDefault();
                        setHeld((p) => p.filter((x) => x !== g.id));
                      }}
                      onPointerCancel={() =>
                        setHeld((p) => p.filter((x) => x !== g.id))
                      }
                      onLostPointerCapture={() =>
                        setHeld((p) => p.filter((x) => x !== g.id))
                      }
                      onKeyDown={(e) => {
                        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                          e.preventDefault();
                          setHeld((p) => [...new Set([...p, g.id])]);
                        }
                      }}
                      onKeyUp={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          setHeld((p) => p.filter((x) => x !== g.id));
                        }
                      }}
                      onBlur={() => setHeld((p) => p.filter((x) => x !== g.id))}
                    >
                      <span className="mic-icon">↟</span>
                      <strong>PUSH TO TALK</strong>
                      <small>
                        {active ? "MICROPHONE LIVE" : "HOLD TO TRANSMIT"}
                      </small>
                    </button>
                    <button
                      className={
                        "latch " + (latch.includes(g.id) ? "selected" : "")
                      }
                      aria-pressed={latch.includes(g.id)}
                      aria-label="Latch to talk"
                      disabled={!ready || !connected}
                      onClick={() =>
                        setLatch((p) =>
                          p.includes(g.id)
                            ? p.filter((x) => x !== g.id)
                            : [...p, g.id],
                        )
                      }
                    >
                      <span>
                        Latch<span className="desktop-label"> to talk</span>
                      </span>{" "}
                      <span>{latch.includes(g.id) ? "ON" : "OFF"}</span>
                    </button>
                    <label className="volume">
                      <span className="volume-label">Listen volume</span>{" "}
                      <output>{Math.round(l.volume * 100)}%</output>
                      <input
                        aria-label={g.name + " listen volume"}
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={l.volume}
                        onChange={(e) =>
                          setListen((p) => ({
                            ...p,
                            [g.id]: { ...l, volume: Number(e.target.value) },
                          }))
                        }
                      />
                    </label>
                  </article>
                );
              })}
            </div>
            {!groups.length && (
              <p className="empty">
                No enabled groups assigned. Ask your administrator to assign
                your channels.
              </p>
            )}
            <footer className="intercom-footer">
              <span>LAN AUDIO · WEBRTC</span>
              <span>
                Hold PTT for momentary talk · Latch for hands-free talk
              </span>
            </footer>
          </>
        )}
        {settings && (
          <div className="modal">
            <section>
              <div className="section-heading">
                <h2>Audio settings</h2>
                <button onClick={() => setSettings(false)}>Close</button>
              </div>
              <p>Use a headset to prevent feedback.</p>
              <button
                className="primary"
                onClick={() => void enable(mic || undefined)}
              >
                Enable Microphone / Refresh devices
              </button>
              <label>
                Microphone
                <select
                  value={mic}
                  onChange={(e) => {
                    setMic(e.target.value);
                    void enable(e.target.value || undefined);
                  }}
                >
                  <option value="">System default</option>
                  {devices
                    .filter((d) => d.kind === "audioinput")
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || "Microphone"}
                      </option>
                    ))}
                </select>
              </label>
              {"setSinkId" in HTMLMediaElement.prototype ? (
                <label>
                  Speaker / Audio Output
                  <select
                    value={output}
                    onChange={async (e) => {
                      const id = e.target.value;
                      try {
                        await engine.current?.setOutput(id);
                        setOutput(id);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <option value="">System default</option>
                    {devices
                      .filter((d) => d.kind === "audiooutput")
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Speaker"}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <p>
                  Output device selection is controlled by the browser/system on
                  this device.
                </p>
              )}
              <p className="muted">
                Your microphone level: {Math.round(user.micGain * 100)}% ·
                managed by your administrator.
              </p>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
