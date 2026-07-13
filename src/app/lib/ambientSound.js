'use client';

/**
 * SPHERE Ambient Sonification System
 * Generates organic, premium low-frequency background drone textures using Web Audio API.
 * Designed to reflect tactical app states and the SPHERE creative project.
 */
class AmbientSonifier {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.oscillators = [];
    this.filter = null;
    this.lfo = null;
    this.lfoGain = null;
    this.isPlaying = false;
    this.rootFreq = 108; // A2 at ~110Hz or low C at 65Hz / 130Hz
  }

  init() {
    if (this.ctx) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('[sphere-synth] Web Audio API is not supported in this environment.');
      return;
    }

    this.ctx = new AudioContextClass();
    
    // Master gain for safe volume levels (extremely quiet, ambient)
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.04, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // Deep low-pass filter to keep drone warm, thick, and non-fatiguing
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.setValueAtTime(1.5, this.ctx.currentTime);
    this.filter.frequency.setValueAtTime(320, this.ctx.currentTime);
    this.filter.connect(this.masterGain);

    // Slow LFO to modulate filter cutoff, simulating breathing / living texture
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.setValueAtTime(0.08, this.ctx.currentTime); // 0.08 Hz (12 seconds per cycle)

    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.setValueAtTime(120, this.ctx.currentTime); // Cutoff sweep range +/- 120Hz

    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.filter.frequency);
    this.lfo.start();
  }

  start(preset = 'sphere-prime') {
    if (this.isPlaying) return;
    this.init();

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const t = this.ctx.currentTime;
    this.oscillators = [];

    // Apply sound signature settings based on preset
    let frequencies = [this.rootFreq, this.rootFreq * 1.5, this.rootFreq * 2]; // Root, Perfect Fifth, Octave
    let waveType = 'triangle'; // Warm, soft harmonics

    if (preset === 'high-tension') {
      // Detuned perfect fifth for alarm / geopolitical warnings
      frequencies = [this.rootFreq * 0.98, this.rootFreq * 1.49, this.rootFreq * 1.98];
      waveType = 'sawtooth'; // Richer, slightly sharper
      this.filter.frequency.setValueAtTime(220, t);
    } else if (preset === 'clear-sky') {
      // Pure, bright major triad drone
      frequencies = [this.rootFreq, this.rootFreq * 1.25, this.rootFreq * 1.5, this.rootFreq * 2]; // Major third
      waveType = 'sine';
      this.filter.frequency.setValueAtTime(450, t);
    } else {
      // 'sphere-prime' - standard calming deep space drone
      frequencies = [this.rootFreq, this.rootFreq * 1.5, this.rootFreq * 2.25]; // Pure intellectual tone
      waveType = 'triangle';
      this.filter.frequency.setValueAtTime(350, t);
    }

    frequencies.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const oscGain = this.ctx.createGain();

      osc.type = waveType;
      osc.frequency.setValueAtTime(freq, t);
      
      // Detune slightly for lush chorusing effect
      if (idx > 0) {
        osc.detune.setValueAtTime((Math.random() - 0.5) * 12, t);
      }

      // Individual osc gains balanced to prevent clipping
      const vol = idx === 0 ? 0.4 : idx === 1 ? 0.3 : 0.2;
      oscGain.gain.setValueAtTime(0, t);
      oscGain.gain.linearRampToValueAtTime(vol, t + 4.0); // 4-second slow fade-in

      osc.connect(oscGain);
      oscGain.connect(this.filter);
      
      osc.start(t);
      this.oscillators.push({ osc, oscGain });
    });

    this.masterGain.gain.cancelScheduledValues(t);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
    this.masterGain.gain.linearRampToValueAtTime(0.05, t + 2.0); // Smooth master fade-in

    this.isPlaying = true;
    console.log(`[sphere-synth] Ambient preset '${preset}' playing...`);
  }

  stop() {
    if (!this.isPlaying) return;

    const t = this.ctx.currentTime;
    
    // Fade out master gain gently over 2 seconds
    this.masterGain.gain.cancelScheduledValues(t);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
    this.masterGain.gain.linearRampToValueAtTime(0, t + 2.0);

    // Stop all oscillators after fade-out
    setTimeout(() => {
      if (!this.isPlaying) {
        this.oscillators.forEach(({ osc }) => {
          try { osc.stop(); } catch (err) { /* ignore */ }
        });
        this.oscillators = [];
        console.log('[sphere-synth] Ambient synthesis stopped.');
      }
    }, 2100);

    this.isPlaying = false;
  }

  setVolume(vol) {
    if (!this.masterGain) return;
    const clampedVol = Math.max(0, Math.min(vol, 0.2)); // Safe cap at 20%
    const t = this.ctx?.currentTime || 0;
    this.masterGain.gain.linearRampToValueAtTime(clampedVol, t + 0.5);
  }

  updateState(preset) {
    if (!this.isPlaying) return;
    this.stop();
    setTimeout(() => {
      this.start(preset);
    }, 2200);
  }
}

// Export singleton instance
export const ambientSonifier = typeof window !== 'undefined' ? new AmbientSonifier() : null;
export default ambientSonifier;
