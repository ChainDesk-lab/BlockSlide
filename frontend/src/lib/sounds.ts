let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(
  freq: number,
  dur: number,
  type: OscillatorType = "sine",
  vol = 0.25,
  startOffset = 0,
) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + startOffset);
    gain.gain.setValueAtTime(0.001, c.currentTime + startOffset);
    gain.gain.linearRampToValueAtTime(vol, c.currentTime + startOffset + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      c.currentTime + startOffset + dur,
    );
    osc.start(c.currentTime + startOffset);
    osc.stop(c.currentTime + startOffset + dur + 0.05);
  } catch {
    // AudioContext may be blocked in some environments — ignore silently
  }
}

function readEnabled(): boolean {
  try {
    const { getDeviceStorage } = require("./unifiedStorage");
    return getDeviceStorage("sound") !== "off";
  } catch {
    return true;
  }
}

export const sounds = {
  enabled: readEnabled(),

  setEnabled(val: boolean) {
    this.enabled = val;
    try {
      const { setDeviceStorage } = require("./unifiedStorage");
      setDeviceStorage("sound", val ? "on" : "off");
    } catch {
      /* ignore */
    }
  },

  /** Played every time tiles slide (no merge). */
  slide() {
    if (!this.enabled) return;
    tone(160, 0.07, "square", 0.035);
  },

  /** Played when tiles merge. Pitch scales with the tile value. */
  merge(tileValue: number) {
    if (!this.enabled) return;
    const base = 280 + Math.log2(Math.max(tileValue, 2)) * 55;
    tone(base, 0.22, "sine", 0.32);
    tone(base * 1.5, 0.12, "sine", 0.12);
  },

  /** Played when a new tile spawns. */
  spawn() {
    if (!this.enabled) return;
    tone(520, 0.07, "sine", 0.07);
  },

  /** Played when the 2048 tile is reached. Ascending fanfare. */
  win() {
    if (!this.enabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((freq, i) => tone(freq, 0.35, "sine", 0.38, i * 0.13));
  },

  /** Played on game over. Descending sad tones. */
  gameOver() {
    if (!this.enabled) return;
    const notes = [440, 370, 311, 262];
    notes.forEach((freq, i) => tone(freq, 0.45, "sawtooth", 0.16, i * 0.19));
  },

  /** Short upbeat chirp on new game start. */
  newGame() {
    if (!this.enabled) return;
    tone(523.25, 0.1, "sine", 0.28, 0);
    tone(659.25, 0.1, "sine", 0.28, 0.1);
  },
};
