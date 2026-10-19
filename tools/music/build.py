"""Cinderbelt music: compose, render, master, validate and encode every track.

    python tools/music/build.py                  # everything (parallel)
    python tools/music/build.py --only calm-home-belt menu-cinderbelt
    python tools/music/build.py --no-encode      # WAV + reports only (tools/music/out/)
    python tools/music/build.py --encode-only    # re-encode the WAV masters already in tools/music/out/
    python tools/music/build.py --no-hq          # skip the dev-only reference encodes

Outputs: public/assets/music/*.opus (Ogg Opus, 48 kHz) + manifest.json, and tools/music/out/<id>/ with
WAV masters, a spectrogram/LTAS PNG per track and out/report.txt (validation). tools/music/out/hq/ gets
the reference encodes at the original bitrates (80 kb/s full mixes) + their own manifest, for A/B
listening on music-demo.html in the dev server; they are git-ignored and never shipped.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

OUT = HERE / "out"
PUBLIC = ROOT / "public" / "assets" / "music"
HQ = OUT / "hq"

# id -> module in tools/music/tracks/ (order = manifest order)
TRACKS = {
    "menu-cinderbelt": "menu_cinderbelt",
    "calm-home-belt": "calm_home_belt",
    "calm-ore-light": "calm_ore_light",
    "calm-station-lights": "calm_station_lights",
    "adventure-far-ring": "adventure_far_ring",
    "adventure-long-burn": "adventure_long_burn",
    "combat-pirate-run": "combat_pirate_run",
    "combat-rust-fortress": "combat_rust_fortress",
    "mystery-kovaci-echo": "mystery_kovaci_echo",
    "mystery-forge-ruins": "mystery_forge_ruins",
}

# Opus bitrates (kb/s, constrained VBR) per stem kind – 48 kHz stereo. These mixes are sparse and tonal
# with little energy above 12 kHz, so 56 kb/s full mixes and 48 kb/s stems keep the full bandwidth and the
# loudness; unconstrained VBR overshoots the target by 25–75 % on this material.
OPUS_KBPS = {"full": 56, "base": 48, "drive": 48, "lead": 48}
# The original encodes (before the size pass) – the dev-only A/B reference in tools/music/out/hq/.
HQ_KBPS = {"full": 80, "base": 64, "drive": 56, "lead": 56}
# A stem whose side signal is at least this far under its mid in every band above 250 Hz has no stereo
# image worth keeping: it is encoded mono (the mid), which also halves its decoded size in the browser.
# The low end is mono by mastering, so it does not count. (Measured: no current stem qualifies – the base
# stems keep pads/reverb at -11…-13 dB side in 250 Hz–2 kHz, the drive stems hats at -13…-15 dB.)
MONO_SIDE_DB = -20.0
MONO_KBPS = 32
STEM_INTENSITY = {"full": 0.0, "base": 0.0, "drive": 0.3, "lead": 0.65}
# Moods whose tracks loop seamlessly in the game. The music director plays the others once and fades
# them out before the end, so the game streams those instead of decoding them whole.
LOOPING_MOODS = {"menu", "combat"}
# A looping file carries LOOP_TAIL seconds past its loop end: the loop start again, encoded with the end
# as context. A lossy codec decodes the last and the first sample of a loop with independent errors, which
# leaves a step at the seam (at 48 kb/s up to twice the largest sample step around it); the player blends
# the tail into the first SEAM_FADE seconds of the loop (smoothLoopSeam in src/audio/music/MusicPlayer.ts),
# so the seam joins two consecutively decoded samples.
LOOP_TAIL = 0.1
SEAM_FADE = 0.02
EXT = "opus"

# Checks on the decoded files (the stems summed, i.e. what the game plays at full intensity).
TARGET_LUFS = -16.0
LUFS_TOLERANCE = 0.2
MAX_TRUE_PEAK = -1.0
# Loop seam: the jump from the last sample to the first, relative to the 99.9th percentile of the
# sample-to-sample motion (afm.analyze.seam_report); a click would be several times the typical step.
MAX_SEAM_RATIO = 1.0


def _ffmpeg() -> str:
    return os.environ.get("FFMPEG", "ffmpeg")


def encode(wav: Path, out: Path, kbps: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav),
                    "-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "constrained", "-application", "audio",
                    "-frame_duration", "20", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                    str(out)], check=True)


def stem_file(track_id: str, name: str) -> str:
    return f"{track_id}.{EXT}" if name == "full" else f"{track_id}-{name}.{EXT}"


def smooth_loop_seam(y, n: int, fade: int):
    """What the player does with a looping file: blend the tail past the loop end (n) into the loop start;
    returns the loop as heard."""
    import numpy as np
    y = y.copy()
    fade = min(fade, y.shape[-1] - n)
    if fade >= 2:
        t = (np.arange(fade) + 0.5) / fade
        y[:, :fade] = y[:, n:n + fade] * (1 - t) + y[:, :fade] * t
    return y[:, :n]


def encode_set(track_id: str, tdir: Path, signals: dict, names: list[str], dest: Path, kbps: dict,
               allow_mono: bool, tail: int, validate: bool) -> tuple[dict, dict]:
    """Encodes the named signals into `dest` (looping ones with `tail` samples of the loop start appended).
    Returns per-file info and, when validating, the checks of the decoded files summed as the player plays
    them (what the game plays at full intensity)."""
    import numpy as np
    import soundfile as sf

    from afm.analyze import seam_report, side_report
    from afm.dsp import SR, true_peak_db
    from afm.render import loudness

    files: dict = {}
    total = None
    for name in names:
        x = signals[name]
        fname = stem_file(track_id, name)
        out = dest / fname
        side = side_report(x)
        mono = allow_mono and max(side.values()) <= MONO_SIDE_DB
        rate = MONO_KBPS if mono else kbps.get(name, 48)
        if mono or tail:
            a = (x[0:1] + x[1:2]) / 2 if mono else x
            if tail:
                a = np.concatenate([a, a[:, :tail]], axis=1)
            wav = tdir / f"{name}.enc.wav"
            sf.write(wav, a.T.astype(np.float32), SR, subtype="FLOAT")
        else:
            wav = tdir / f"{name}.wav"
        encode(wav, out, rate)
        size = out.stat().st_size
        info = dict(file=fname, channels=1 if mono else 2, target_kbps=rate, bytes=size,
                    side_db={k: round(v, 1) for k, v in side.items()})
        if validate:
            y, _ = sf.read(out, always_2d=True)
            y = y.T
            if y.shape[0] == 1:
                y = np.repeat(y, 2, axis=0)  # Web Audio plays a mono buffer on both channels
            samples = int(y.shape[1])
            if tail:
                y = smooth_loop_seam(y, x.shape[-1], round(SEAM_FADE * SR))
            info.update(true_peak=true_peak_db(y), samples=samples, expected=int(x.shape[-1]) + tail,
                        kbps=round(size * 8 / 1000 / (samples / SR), 1), seam=seam_report(y)["ratio"])
            total = y if total is None else total + y
        files[name] = info
    checks: dict = {}
    if validate and total is not None:
        checks = dict(lufs=loudness(total), true_peak=true_peak_db(total), seam=seam_report(total)["ratio"])
        fails = []
        if abs(checks["lufs"] - TARGET_LUFS) > LUFS_TOLERANCE:
            fails.append(f"loudness {checks['lufs']:.2f} LUFS")
        for label, v in [("mix", checks["true_peak"])] + [(n, f["true_peak"]) for n, f in files.items()]:
            if v >= MAX_TRUE_PEAK:
                fails.append(f"true peak {label} {v:.2f} dBTP")
        for label, v in [("mix", checks["seam"])] + [(n, f["seam"]) for n, f in files.items()]:
            if v >= MAX_SEAM_RATIO:
                fails.append(f"loop seam {label} x{v:.2f}")
        for n, f in files.items():
            if f["samples"] != f["expected"]:
                fails.append(f"{n}: {f['samples']} samples, expected {f['expected']}")
        checks["fails"] = fails
    return files, checks


def build_one(track_id: str, do_encode: bool, render: bool, hq: bool) -> dict:
    import numpy as np
    import soundfile as sf

    from afm import analyze
    from afm.dsp import SR

    mod = importlib.import_module(f"tracks.{TRACKS[track_id]}")
    song = mod.build()
    assert song.id == track_id, (song.id, track_id)
    logs: list[str] = []
    tdir = OUT / track_id
    tdir.mkdir(parents=True, exist_ok=True)
    reports = {}
    info = {}
    order = lambda n: (STEM_INTENSITY.get(n, 1.0), n)  # noqa: E731
    if render:
        from afm.render import render_song
        from afm.song import lint
        for w in lint(song, getattr(song, "lint_parts", ["lead"])):
            logs.append("  LINT " + w)
        res = render_song(song, log=logs.append)
        info = res["info"]
        full = res["full"]
        stems = {n: res["stems"][n] for n in sorted(res["stems"], key=order)}
        sf.write(tdir / "full.wav", full.T.astype(np.float32), SR, subtype="FLOAT")
        reports["full"] = analyze.analyze(full)
        analyze.plot(full, reports["full"], str(tdir / "full.png"), f"{song.title} ({track_id})",
                     song.sections, song.spb * song.bpb)
        analyze.plot_chroma(full, str(tdir / "chroma.png"), f"{song.title}: chroma per bar", song.sections,
                            song.spb * song.bpb)
        if len(stems) > 1:
            for name, x in stems.items():
                sf.write(tdir / f"{name}.wav", x.T.astype(np.float32), SR, subtype="FLOAT")
                reports[name] = analyze.analyze(x)
                analyze.plot(x, reports[name], str(tdir / f"{name}.png"), f"{song.title} – stem {name}",
                             song.sections, song.spb * song.bpb)
        for r in reports.values():
            r.pop("_ltas", None)
    else:
        # --encode-only: the WAV masters of an earlier render (the render is deterministic)
        def read(name: str):
            y, _ = sf.read(tdir / f"{name}.wav", always_2d=True, dtype="float32")
            return y.T
        full = read("full")
        found = [p.stem for p in tdir.glob("*.wav") if p.stem != "full" and "." not in p.stem]
        stems = {n: read(n) for n in sorted(found, key=order)}

    # A layered track ships only its stems: they sum to the full mix sample for sample (the master's gain
    # curves are applied identically to every stem), so its full.wav is rendered for analysis only.
    names = list(stems) if len(stems) > 1 else ["full"]
    # the WAV masters are float32: encode from them so a render and --encode-only give identical files
    signals = {n: (full if n == "full" else stems[n]).astype(np.float32).astype(np.float64) for n in names}
    files: dict = {}
    checks: dict = {}
    hq_files: dict = {}
    loop = song.mood in LOOPING_MOODS
    if do_encode:
        files, checks = encode_set(track_id, tdir, signals, names, PUBLIC, OPUS_KBPS, allow_mono=True,
                                   tail=round(LOOP_TAIL * SR) if loop else 0, validate=True)
        if hq:
            # the files exactly as they shipped before the size pass (no tail: the whole file loops)
            hq_files, _ = encode_set(track_id, tdir, signals, names, HQ, HQ_KBPS, allow_mono=False, tail=0,
                                     validate=False)
    manifest_entry = dict(
        id=song.id, title=song.title, mood=song.mood, bpm=getattr(song, "display_bpm", song.bpm), key=song.key,
        meter=getattr(song, "meter", f"{song.bpb}/4"), bars=song.bars,
        duration=round(full.shape[-1] / SR, 6), samples=int(full.shape[-1]),
        loopStart=0, loopEnd=round(full.shape[-1] / SR, 6),
        loop=loop,
        gain=getattr(song, "gain", 1.0),
        stems=[dict(id=n, file=stem_file(track_id, n), minIntensity=STEM_INTENSITY.get(n, 0.0)) for n in names],
    )
    return dict(id=track_id, logs=logs, info=info, reports=reports, decoded=files, checks=checks, hq=hq_files,
                manifest=manifest_entry, sections=song.sections, notes=song.notes)


def write_manifest(folder: Path, entries: dict, ids: list[str]) -> float:
    """Writes folder/manifest.json (keeping the entries of tracks not rebuilt this time); returns MiB."""
    mpath = folder / "manifest.json"
    old = json.loads(mpath.read_text()) if mpath.exists() else {"tracks": []}
    by_id = {t["id"]: t for t in old.get("tracks", [])}
    for tid in ids:
        by_id[tid] = entries[tid]
    tracks = [by_id[t] for t in TRACKS if t in by_id]
    manifest = {"version": 1, "sampleRate": 48000, "tracks": tracks}
    mpath.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    missing = [s["file"] for t in tracks for s in t["stems"] if not (folder / s["file"]).exists()]
    if missing:
        print(f"WARNING: {mpath} lists missing files:", missing)
    return sum((folder / s["file"]).stat().st_size for t in tracks for s in t["stems"]
               if (folder / s["file"]).exists()) / 1024 / 1024


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--jobs", type=int, default=min(10, os.cpu_count() or 2))
    ap.add_argument("--no-encode", action="store_true")
    ap.add_argument("--encode-only", action="store_true", help="re-encode the WAV masters in tools/music/out/")
    ap.add_argument("--no-hq", action="store_true", help="skip the dev-only reference encodes (out/hq/)")
    ap.add_argument("--lint", action="store_true", help="only compose and check the melodies against the harmony")
    args = ap.parse_args()
    ids = args.only or list(TRACKS)
    if args.lint:
        from afm.song import lint
        for tid in ids:
            song = importlib.import_module(f"tracks.{TRACKS[tid]}").build()
            ws = lint(song, getattr(song, "lint_parts", ["lead"]))
            print(f"{tid}: {song.bars} bars, {song.seconds:.1f}s, {sum(len(p.events) for p in song.parts)} events, "
                  f"{len(ws)} lint warnings")
            for w in ws:
                print("  " + w)
        return
    OUT.mkdir(exist_ok=True)
    t0 = time.time()
    results = {}
    hq = not args.no_hq
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        futs = {tid: ex.submit(build_one, tid, not args.no_encode, not args.encode_only, hq) for tid in ids}
        for tid, fut in futs.items():
            results[tid] = fut.result()
            for line in results[tid]["logs"]:
                print(line)

    # ---- report
    from afm.analyze import summary_line
    lines = []
    fails = []
    for tid in ids:
        r = results[tid]
        for name, rep in r["reports"].items():
            lines.append(summary_line(f"{tid}:{name}", rep))
        for name, d in r["decoded"].items():
            side = ", ".join(f"{k} {v:+.1f}" for k, v in d["side_db"].items())
            lines.append(f"{'':<28} opus {name}: {d['channels']} ch, {d['bytes'] / 1024:.1f} KiB, {d['kbps']} kb/s, "
                         f"TP {d['true_peak']:.2f} dBTP, seam x{d['seam']:.2f}, samples {d['samples']} "
                         f"(expected {d['expected']}); side/mid dB [{side}]")
        c = r["checks"]
        if c:
            lines.append(f"{'':<28} decoded mix: {c['lufs']:.2f} LUFS, TP {c['true_peak']:.2f} dBTP, "
                         f"seam x{c['seam']:.2f}" + ("" if not c["fails"] else "  FAIL: " + "; ".join(c["fails"])))
            fails += [f"{tid}: {f}" for f in c["fails"]]
    report = "\n".join(lines)
    print(report)
    prev = {}
    rpath = OUT / "report.json"
    if rpath.exists():
        prev = json.loads(rpath.read_text())
    for tid in ids:
        entry = {k: v for k, v in results[tid].items() if k != "logs"}
        if args.encode_only:
            # keep the analysis of the render that produced the WAVs
            entry = {**prev.get(tid, {}), **{k: v for k, v in entry.items() if k not in ("reports", "info")}}
        prev[tid] = entry
    rpath.write_text(json.dumps(prev, indent=1, default=float))
    (OUT / "report.txt").write_text(report + "\n")

    # ---- manifests (each keeps the entries of tracks not rebuilt this time)
    if not args.no_encode:
        entries = {tid: results[tid]["manifest"] for tid in ids}
        total = write_manifest(PUBLIC, entries, ids)
        print(f"manifest: {len(TRACKS)} tracks, {total:.2f} MiB total")
        if hq:
            total_hq = write_manifest(HQ, entries, ids)
            print(f"reference set (out/hq, dev only): {total_hq:.2f} MiB total")
    print(f"done in {time.time() - t0:.0f}s")
    if fails:
        print("VALIDATION FAILED:\n  " + "\n  ".join(fails))
        sys.exit(1)


if __name__ == "__main__":
    main()
