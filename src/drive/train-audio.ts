/**
 * Train sounds and an original music loop, generated in the browser with the Web Audio
 * API: no recordings to license or download. Starts only after a click, as browsers require.
 */
const BPM = 76;
const BEAT = 60 / BPM;
// A mellow ii–V–I–vi in D major, as MIDI notes.
const CHORDS = [[52, 55, 59, 62], [57, 61, 64, 67], [50, 54, 57, 61], [47, 50, 54, 57]];
const MELODY = [74, 76, 78, 76, 73, 71, 73, 69, 74, 71, 69, 66, 69, 71, 73, 76];
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);

export class TrainAudio {
  private context: AudioContext | null = null;
  private master!: GainNode;
  private rumble!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private nextStep = 0;
  private step = 0;
  private nextClack = 0;
  private playing = false;
  muted = false;

  /** Call from a click or key handler. */
  start(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = this.context = new Context();
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(context.destination);
    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = this.noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < data.length; i++) {
      brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = brown * 3.2;
    }
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    this.rumbleFilter = context.createBiquadFilter();
    this.rumbleFilter.type = "lowpass";
    this.rumble = context.createGain();
    this.rumble.gain.value = 0;
    source.connect(this.rumbleFilter).connect(this.rumble).connect(this.master);
    source.start();
    this.music = context.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.context.currentTime, 0.08);
  }

  /** The beat position, for nodding along. */
  get beat(): number {
    return this.context && this.playing ? this.context.currentTime / BEAT : 0;
  }

  stop(): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.rumble.gain.setTargetAtTime(0, now, 0.4);
    this.music.gain.setTargetAtTime(0, now, 0.3);
    this.playing = false;
  }

  /** `speed` in m/s. `music` plays the loop over the train sounds. */
  update(speed: number, music: boolean, quiet: boolean): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    const pace = Math.min(1, speed / 31);
    // Quieter while reading or resting, and under the music.
    const level = (0.05 + 0.22 * pace) * (quiet ? 0.55 : 1) * (music ? 0.5 : 1);
    this.rumble.gain.setTargetAtTime(level, now, 0.3);
    this.rumbleFilter.frequency.setTargetAtTime(140 + 420 * pace, now, 0.3);
    // Rail joints: a double clack every 25 m.
    if (speed > 2 && now >= this.nextClack) {
      this.clack(now, level);
      this.nextClack = now + Math.max(0.35, 25 / speed);
    }
    this.music.gain.setTargetAtTime(music ? 0.42 : 0, now, 0.4);
    this.playing = music;
    if (!music) {
      this.nextStep = 0;
      return;
    }
    if (this.nextStep < now) this.nextStep = now + 0.05;
    while (this.nextStep < now + 0.3) {
      this.schedule(this.step, this.nextStep);
      this.step = (this.step + 1) % 32;
      this.nextStep += BEAT / 2;
    }
  }

  private burst(time: number, filter: number, gain: number, length: number, target: AudioNode): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = filter;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + length);
    source.connect(band).connect(envelope).connect(target);
    source.start(time, Math.random(), length + 0.05);
  }

  private clack(time: number, level: number): void {
    this.burst(time, 900, level * 2.2, 0.07, this.master);
    this.burst(time + 0.13, 760, level * 1.8, 0.07, this.master);
  }

  private tone(note: number, time: number, length: number, gain: number, type: OscillatorType): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = hz(note);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(gain, time + 0.04);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + length);
    oscillator.connect(envelope).connect(this.music);
    oscillator.start(time);
    oscillator.stop(time + length + 0.05);
  }

  /** One eighth note of a gentle four-bar loop. */
  private schedule(step: number, time: number): void {
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    if (step % 8 === 0) {
      for (const note of chord) this.tone(note, time, BEAT * 3.8, 0.05, "triangle");
      this.tone(chord[0] - 12, time, BEAT * 1.8, 0.16, "sine");
    }
    if (step % 8 === 4) this.tone(chord[0] - 12, time, BEAT * 1.6, 0.12, "sine");
    if (step % 2 === 1) this.tone(MELODY[(step >> 1) % MELODY.length], time, BEAT * 0.9, 0.045, "sine");
    if (step % 4 === 0) this.burst(time, 120, 0.5, 0.18, this.music);
    if (step % 4 === 2) this.burst(time, 2400, 0.12, 0.1, this.music);
    this.burst(time, 7000, 0.035, 0.03, this.music);
  }
}
