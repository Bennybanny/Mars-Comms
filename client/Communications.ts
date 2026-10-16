import type { ClientMessage, ServerMessage, Peer } from "../shared/types";
import { AudioEngine } from "./AudioEngine";
type Link = {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  pending: RTCIceCandidateInit[];
};
export class Communications {
  ws?: WebSocket;
  self = "";
  peers: Peer[] = [];
  links = new Map<string, Link>();
  timer?: ReturnType<typeof setTimeout>;
  stopped = false;
  talk: string[] = [];
  externalTalk: string[] = [];
  mediaReady = false;
  private updateAudio() {
    this.audio.update(
      this.peers,
      this.mediaReady
        ? [...new Set([...this.talk, ...this.externalTalk])]
        : this.talk,
      this.listen,
    );
  }
  listen: Record<string, number> = {};
  onSnapshot: (m: Extract<ServerMessage, { type: "snapshot" }>) => void =
    () => {};
  onStatus: (s: string) => void = () => {};
  onReset: () => void = () => {};
  private lastMessage = Date.now();
  private watchdog?: ReturnType<typeof setInterval>;
  private offline = () => {
    this.reset();
    this.onStatus("RECONNECTING");
    this.ws?.close();
  };
  constructor(public audio: AudioEngine) {
    window.addEventListener("offline", this.offline);
    this.watchdog = setInterval(() => {
      if (
        this.ws?.readyState === WebSocket.OPEN &&
        Date.now() - this.lastMessage >
          (this.externalTalk.length ? 5000 : 12000)
      )
        this.offline();
      else this.send({ type: "heartbeat" });
    }, 2000);
  }
  connect() {
    if (this.stopped) return;
    this.onStatus("RECONNECTING");
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/signal`,
    );
    this.ws = ws;
    ws.onopen = () => {
      this.lastMessage = Date.now();
      this.onStatus("CONNECTED");
      this.state([], this.listen);
    };
    ws.onmessage = (e) => {
      this.lastMessage = Date.now();
      void this.message(JSON.parse(e.data)).catch((err) =>
        this.audio.error("Audio connection: " + err.message),
      );
    };
    ws.onclose = () => {
      this.reset();
      if (!this.stopped) {
        this.onStatus("RECONNECTING");
        this.timer = setTimeout(() => this.connect(), 2000);
      }
    };
    ws.onerror = () => ws.close();
  }
  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  state(
    talk: string[],
    listen: Record<string, number>,
    mediaReady = this.mediaReady,
  ) {
    this.talk = this.ws?.readyState === WebSocket.OPEN ? talk : [];
    this.listen = listen;
    this.mediaReady = mediaReady;
    this.updateAudio();
    this.send({
      type: "state",
      talk: this.talk,
      listen: Object.keys(listen).filter((g) => listen[g] > 0),
      mediaReady,
    });
  }
  async sync() {
    if (!this.audio.ready) return;
    for (const p of this.peers) {
      if (this.links.has(p.id)) continue;
      const pc = new RTCPeerConnection({ iceServers: [] });
      const link: Link = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        polite: this.self > p.id,
        pending: [],
      };
      this.links.set(p.id, link);
      pc.addTrack(this.audio.outgoing(p.id));
      pc.onicecandidate = (e) => {
        if (e.candidate)
          this.send({
            type: "signal",
            to: p.id,
            candidate: e.candidate.toJSON(),
          });
      };
      pc.ontrack = (e) => this.audio.receive(p.id, new MediaStream([e.track]));
      pc.onnegotiationneeded = async () => {
        try {
          link.makingOffer = true;
          await pc.setLocalDescription();
          this.send({
            type: "signal",
            to: p.id,
            description: pc.localDescription!.toJSON(),
          });
        } catch (e) {
          this.audio.error(String(e));
        } finally {
          link.makingOffer = false;
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          this.audio.error(
            "Peer connection failed. Check LAN/firewall; reconnecting.",
          );
          pc.restartIce();
        }
      };
    }
    this.updateAudio();
  }
  async message(m: ServerMessage) {
    if (m.type === "snapshot") {
      this.self = m.self;
      this.peers = m.peers;
      this.externalTalk = m.externalTalk ?? [];
      for (const [id, l] of this.links)
        if (!m.peers.some((p) => p.id === id)) {
          l.pc.close();
          this.links.delete(id);
          this.audio.remove(id);
        }
      this.onSnapshot(m);
      await this.sync();
      this.audio.setGain(m.user.micGain);
      this.updateAudio();
      return;
    }
    // Listen-only clients acquire their media pipeline on Enable Microphone before joining media negotiation.
    await this.sync();
    const l = this.links.get(m.from);
    if (!l) return;
    const pc = l.pc;
    if (m.description) {
      const collision =
        m.description.type === "offer" &&
        (l.makingOffer || pc.signalingState !== "stable");
      l.ignoreOffer = !l.polite && collision;
      if (l.ignoreOffer) return;
      await pc.setRemoteDescription(m.description);
      for (const candidate of l.pending.splice(0))
        await pc.addIceCandidate(candidate);
      if (m.description.type === "offer") {
        await pc.setLocalDescription();
        this.send({
          type: "signal",
          to: m.from,
          description: pc.localDescription!.toJSON(),
        });
      }
    } else if (m.candidate) {
      if (l.ignoreOffer) return;
      if (pc.remoteDescription) await pc.addIceCandidate(m.candidate);
      else l.pending.push(m.candidate);
    }
  }
  reset() {
    this.talk = [];
    this.externalTalk = [];
    this.mediaReady = false;
    this.audio.silence();
    for (const [id, l] of this.links) {
      l.pc.close();
      this.audio.remove(id);
    }
    this.links.clear();
    this.peers = [];
    this.onReset();
  }
  close() {
    this.stopped = true;
    window.removeEventListener("offline", this.offline);
    clearInterval(this.watchdog);
    clearTimeout(this.timer);
    this.ws?.close();
    this.reset();
    this.onStatus("DISCONNECTED");
  }
}
