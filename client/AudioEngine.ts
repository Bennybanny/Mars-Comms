import { routeVolume, type Peer } from "../shared/types";
type SinkAudio = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};
export class AudioEngine {
  context?: AudioContext;
  source?: MediaStreamAudioSourceNode;
  capture?: MediaStream;
  gain?: GainNode;
  destination?: MediaStreamAudioDestinationNode;
  output = "";
  peers = new Map<
    string,
    {
      gate: GainNode;
      destination: MediaStreamAudioDestinationNode;
      audio: SinkAudio;
    }
  >();
  error: (message: string) => void = () => {};
  get ready() {
    return !!this.capture;
  }
  async enable(deviceId?: string) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error(
        "Microphone requires trusted HTTPS on LAN devices, or localhost. See README.",
      );
    const capture = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
      this.gain ??= this.context.createGain();
      this.source?.disconnect();
      this.capture?.getTracks().forEach((t) => t.stop());
      this.capture = capture;
      this.source = this.context.createMediaStreamSource(capture);
      this.source.connect(this.gain);
      for (const peer of this.peers.values()) {
        if (peer.audio.srcObject) await peer.audio.play();
      }
      capture.getAudioTracks()[0].onended = () =>
        this.error(
          "Microphone disconnected. Stop talking and enable another microphone.",
        );
    } catch (e) {
      capture.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }
  setGain(value: number) {
    if (this.gain) this.gain.gain.value = Math.max(0, Math.min(1.5, value));
  }
  outgoing(id: string) {
    if (!this.context || !this.gain) throw Error("Enable microphone first");
    let p = this.peers.get(id);
    if (!p) {
      const gate = this.context.createGain();
      gate.gain.value = 0;
      const destination = this.context.createMediaStreamDestination();
      this.gain.connect(gate);
      gate.connect(destination);
      const audio = document.createElement("audio") as SinkAudio;
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      document.body.append(audio);
      p = { gate, destination, audio };
      this.peers.set(id, p);
      if (this.output)
        void audio.setSinkId?.(this.output).catch((e) => this.error(e.message));
    }
    return p.destination.stream.getAudioTracks()[0];
  }
  receive(id: string, stream: MediaStream) {
    const p = this.peers.get(id);
    if (p) {
      p.audio.srcObject = stream;
      void p.audio
        .play()
        .catch(() =>
          this.error(
            "Playback blocked. Press Enable Microphone to resume audio.",
          ),
        );
    }
  }
  update(peers: Peer[], talk: string[], listen: Record<string, number>) {
    for (const [id, p] of this.peers) {
      const remote = peers.find((x) => x.id === id);
      p.gate.gain.value =
        remote && talk.some((g) => remote.listen.includes(g)) ? 1 : 0;
      p.audio.volume = remote ? routeVolume(remote.talk, listen) : 0;
    }
  }
  silence() {
    for (const p of this.peers.values()) p.gate.gain.value = 0;
  }
  async setOutput(id: string) {
    for (const p of this.peers.values()) {
      if (!p.audio.setSinkId)
        throw Error(
          "Output device selection is controlled by the browser/system on this device.",
        );
      await p.audio.setSinkId(id);
    }
    this.output = id;
  }
  remove(id: string) {
    const p = this.peers.get(id);
    if (p) {
      this.gain?.disconnect(p.gate);
      p.gate.disconnect();
      p.destination.stream.getTracks().forEach((t) => t.stop());
      p.audio.srcObject = null;
      p.audio.remove();
      this.peers.delete(id);
    }
  }
  dispose() {
    for (const id of this.peers.keys()) this.remove(id);
    this.capture?.getTracks().forEach((t) => t.stop());
    void this.context?.close();
  }
}
