/**
 * The timer's ring: three short beeps and, where the phone allows it (not iPhone), a buzz.
 * Browsers only play sound from an audio context a tap started, so Start calls `primeAlarm()`
 * and the ring later reuses that context.
 */
let context: AudioContext | null = null;

export function primeAlarm(): void {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    // No Web Audio here: the ring is the buzz and the face alone.
  }
}

export function ringAlarm(): void {
  try {
    navigator.vibrate?.([200, 100, 200, 100, 200]);
  } catch {
    // Not supported.
  }
  if (!context) return;
  try {
    void context.resume();
    const start = context.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      const at = start + i * 0.3;
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = "sine";
      tone.frequency.value = 880;
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(0.3, at + 0.01);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      tone.connect(volume).connect(context.destination);
      tone.start(at);
      tone.stop(at + 0.22);
    }
  } catch {
    // A closed or blocked context: nothing to play.
  }
}
