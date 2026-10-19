# Cinderbelt – music pipeline

Original music for the game, composed as code and rendered offline. No samples, no downloaded
music: every instrument is synthesized here (additive / FM / noise), mixed, mastered and checked.

```
pip install -r tools/music/requirements.txt      # numpy, scipy, numba, soundfile, pyloudnorm, matplotlib
python tools/music/build.py                      # all tracks, in parallel (~5 min on 10 cores)
python tools/music/build.py --only calm-home-belt combat-pirate-run
python tools/music/build.py --lint               # compose only: check melodies against the harmony
python tools/music/build.py --no-encode          # WAV + reports, leave public/ alone
python tools/music/build.py --encode-only        # re-encode the WAV masters in out/ (seconds, no render)
python tools/music/build.py --no-hq              # skip the dev-only reference encodes (out/hq/)
```

Needs `ffmpeg` with libopus on PATH (or `FFMPEG=/path/to/ffmpeg`). Renders are deterministic
(every part has its own seeded RNG) and the Opus files are muxed bit-exact, so a rebuild reproduces the
committed files byte for byte (same ffmpeg/libopus build).

## Outputs

- `public/assets/music/<id>.opus` (or `<id>-<stem>.opus`) – Ogg Opus, 48 kHz stereo, constrained VBR:
  56 kb/s full mixes, 48 kb/s combat stems (10.0 MiB in all; the first release used 80 kb/s and
  64/56/56 kb/s stems, 13.6 MiB). A stem whose side signal is ≥ 20 dB under its mid in every band above
  250 Hz is encoded mono at 32 kb/s (`MONO_SIDE_DB`); none qualifies today – the base stems carry pads and
  reverb at −11…−13 dB side in 250 Hz–2 kHz, the drive stems hats at −13…−15 dB (their low end is mono by
  mastering, so the overall correlation of 0.93–0.99 overstates how mono they are).
- `public/assets/music/manifest.json` – what the game reads:
  `{ version, sampleRate, tracks: [{ id, title, mood, bpm, key, meter, bars, duration, samples, loopStart,
  loopEnd, loop, gain, stems: [{ id, file, minIntensity }] }] }`.
  Moods: `menu`, `calm`, `adventure`, `combat`, `mystery`. `loop` is true for `menu` and `combat` (the
  director loops them); the others play once, so the game streams them through an `<audio>` element
  instead of decoding them whole.
- Looping files run 0.1 s past `loopEnd` (`LOOP_TAIL`): that tail is the loop start again, encoded as the
  continuation of the end. A lossy codec decodes the last and the first sample of a loop with independent
  errors, which leaves a step at the seam (at 48 kb/s up to twice the largest sample step around it); the
  player blends the tail into the first 20 ms of the loop (`smoothLoopSeam`, `SEAM_FADE`), so the seam
  joins two samples decoded one after the other. The build validates exactly that.
- Combat cues ship only their stems (`base` always on, `drive` from intensity 0.3, `lead` from 0.65). The
  stems sum to the full mix sample for sample (|sum − full| < 1e-7), so no full mix is shipped; the
  combat `full.wav` in `out/` is rendered for the analysis only. Low intensity is the base stem alone.
- `tools/music/out/hq/` (git-ignored, dev only): the reference encodes at the original bitrates – the
  files exactly as first released (no tail; the whole file loops) – with their own `manifest.json`.
  `music-demo.html` in the dev server (`npm run dev`) has an **Original / Compressed** switch that plays
  them from the same position for an A/B by ear. The production build never references them.
- `tools/music/out/` (git-ignored): float WAV masters, `full.png` (waveform with section markers,
  log spectrogram, long-term spectrum, pitch-class energy), `chroma.png` (harmony per bar),
  `report.txt` / `report.json` (validation numbers).

## How a track is made

1. **Score** (`tracks/*.py`): each module builds a `Song` – chord progressions per section, voicings
   chosen by a voice-leading search (`afm/theory.py`: guide tones required, no minor seconds, no mud
   below E3, pedal tones held over more than two chords are penalised), melodies written per bar
   (`bars()` asserts every bar is complete), arpeggios, walking bass with diatonic approach notes,
   drum patterns. `harmony()` registers the chord timeline and `lint()` flags melody notes that
   clash with the chord under them (minor ninths, avoid notes).
2. **Instruments** (`afm/instruments.py`, `afm/drums.py`): additive voices rendered by a numba kernel
   with per-partial envelopes (pads with a slowly breathing 12 dB/oct "filter", strings, choir with
   moving vowel formants, plucks/harp, marimba/vibes/kalimba/glockenspiel/glass/bell modal models,
   bass, soft and saw leads, arp plucks), an FM electric piano, and sine/noise drums. All filters are
   low-Q – nothing rings.
3. **Mix** (`afm/render.py`): humanised timing/velocity, swing, per-part EQ/chorus/autopan/width,
   each part normalised to a target loudness (`level`, LU relative to the lead) so the balance does
   not depend on raw synth levels, kick-keyed ducking, a synthetic stereo hall (frequency-dependent
   decay, band-limited 200 Hz–7 kHz return) and a ping-pong tempo delay.
4. **Seamless loops**: the whole song is a circular buffer. Notes and tails past the end wrap to the
   start, reverb is a circular convolution, chorus/autopan LFOs have an integer number of cycles per
   loop, and stateful processors (IIR EQ, compressor, limiter) run over a pre-rolled copy – so the
   last sample flows into the first and the loop point is `0 … duration`.
5. **Master**: low-end mono below 140 Hz, gentle tilt EQ, glue compressor and look-ahead limiter whose
   gain curves are computed on the full mix and applied identically to every stem (stems sum to
   the master), loudness normalised to −16 LUFS integrated, ceiling −2 dBFS (true peak checked on the
   decoded Opus file).
6. **Encoding checks** (`build.py`, on the decoded Opus files, stems summed as the game plays them at
   full intensity, loop tail blended as the player does): integrated loudness −16 ± 0.2 LUFS, true peak
   below −1 dBTP for every file and for the sum, loop seam ratio below 1 (see below), exact sample
   count. A failure exits with status 1.
7. **Validation** (`afm/analyze.py`): integrated / short-term loudness, true peak (4× oversampling),
   clipping, DC offset, band energies against a log-frequency trend (mud 200–500 Hz, harshness
   2–5 kHz), semitone bands that dominate the long-term spectrum (resonance / drone check), the longest
   time any bin stays near the top of the spectrum (static-tone check), pitch-class distribution,
   stereo correlation (full band and < 120 Hz), and the loop seam discontinuity.

## Adding a track

Copy a module in `tracks/`, give it a unique id, register it in `TRACKS` in `build.py`, run
`build.py --lint --only <id>`, then render and look at `out/<id>/full.png` and `chroma.png`.
Stems: set `stem="base" | "drive" | "lead"` on parts; `STEM_INTENSITY` in `build.py` sets the
`minIntensity` written to the manifest.
