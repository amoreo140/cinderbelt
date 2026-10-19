import { describe, expect, it } from 'vitest';
import { echoSites } from '../discovery/poi';
import { GAS_GIANT_ANCHOR, LANDMARK_RULES, landmarkSites, landmarksNear } from './landmarks';
import { ringIndexAt } from './rings';

const SEEDS = [1, 7, 42, 1234, 99991, 0xdeadbeef, 2026];
const bearingDeg = (p: { x: number; y: number }) => (Math.atan2(p.y, p.x) * 180) / Math.PI;
const diffDeg = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('landmarkSites', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = landmarkSites(42);
    const b = JSON.parse(JSON.stringify(a));
    // a fresh computation (the cache is per seed – other seeds in between must not change it)
    for (const s of SEEDS) landmarkSites(s);
    expect(JSON.parse(JSON.stringify(landmarkSites(42)))).toEqual(b);
    expect(landmarkSites(43).map((s) => s.pos)).not.toEqual(a.map((s) => s.pos));
  });

  it('places the counts per kind from the manifest and unique ids', () => {
    const sites = landmarkSites(7);
    const count = (k: string) => sites.filter((s) => s.kind === k).length;
    expect(count('gas_giant')).toBe(1);
    expect(count('guild_relay')).toBe(1);
    expect(count('rust_ring_shard')).toBe(3);
    expect(count('crystal_spire')).toBe(4);
    expect(count('dead_forge')).toBe(2);
    expect(new Set(sites.map((s) => s.id)).size).toBe(sites.length);
  });

  it('anchors the gas giant at home + (-1150, 2270)', () => {
    for (const seed of SEEDS) {
      const g = landmarkSites(seed).find((s) => s.kind === 'gas_giant')!;
      expect(g.pos).toEqual(GAS_GIANT_ANCHOR);
    }
  });

  it('keeps every site in its radius band, ring and yaw range', () => {
    for (const seed of SEEDS) {
      for (const s of landmarkSites(seed)) {
        if (s.kind === 'gas_giant') continue;
        const rule = LANDMARK_RULES.find((r) => r.kind === s.kind)!;
        const d = Math.hypot(s.pos.x, s.pos.y);
        expect(d).toBeGreaterThanOrEqual(rule.radius[0]);
        expect(d).toBeLessThanOrEqual(rule.radius[1]);
        expect(ringIndexAt(d)).toBe(rule.ring);
        expect(s.ring).toBe(rule.ring);
        const yaw = (s.yaw * 180) / Math.PI;
        expect(yaw).toBeGreaterThanOrEqual(rule.yawDeg[0] - 1e-9);
        expect(yaw).toBeLessThanOrEqual(rule.yawDeg[1] + 1e-9);
      }
    }
  });

  it('puts the relay mast in the eastern half, away from Echo-0', () => {
    for (let seed = 0; seed < 200; seed++) {
      const relay = landmarkSites(seed).find((s) => s.kind === 'guild_relay')!;
      const b = bearingDeg(relay.pos);
      expect(Math.abs(b)).toBeLessThanOrEqual(70 + 1e-6);
      const echo = bearingDeg(echoSites(seed)[0]!.pos);
      expect(diffDeg(b, echo)).toBeGreaterThanOrEqual(30 - 1e-6);
    }
  });

  it('spreads the multi-instance kinds around home (ring shards ~120°, walls ~90°, forges opposite)', () => {
    for (const seed of SEEDS) {
      const sites = landmarkSites(seed);
      const bearings = (k: string) => sites.filter((s) => s.kind === k).map((s) => bearingDeg(s.pos));
      const shards = bearings('rust_ring_shard');
      for (let i = 0; i < 3; i++) expect(diffDeg(shards[i]!, shards[(i + 1) % 3]!)).toBeGreaterThanOrEqual(120 - 50);
      const walls = bearings('crystal_spire');
      for (let i = 0; i < 4; i++) expect(diffDeg(walls[i]!, walls[(i + 1) % 4]!)).toBeGreaterThanOrEqual(90 - 40);
      const forges = bearings('dead_forge');
      expect(diffDeg(forges[0]!, forges[1]!)).toBeGreaterThanOrEqual(180 - 30);
    }
  });

  it('finds the sites near a point', () => {
    const sites = landmarkSites(42);
    expect(landmarksNear(sites, { x: 0, y: 0 }, 1300).map((s) => s.kind)).toEqual(['guild_relay']);
    expect(landmarksNear(sites, GAS_GIANT_ANCHOR, 1).map((s) => s.kind)).toEqual(['gas_giant']);
  });
});
