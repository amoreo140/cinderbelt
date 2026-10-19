import { describe, expect, it } from 'vitest';
import { nodeFs } from '../testing/nodeFs';
import { captainDefs } from '../sim/captains/captains';
import { STATION_MODELS } from './stations';
import { captainPortrait, PORTRAIT_IDS, PORTRAITS, SPEAKERS, trafficPortrait, trafficRole } from './speakers';

const DIR = 'public/assets/ui/portraits';
const fs = nodeFs();

interface Manifest {
  size: number;
  size2x: number;
  portraits: { id: string; file: string; file2x: string; faction: string; role: string; accent: string }[];
}

describe('speakers and the portrait manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(`${DIR}/portraits.json`, 'utf8')) as Manifest;

  it('every portrait id, faction, role and accent matches portraits.json and its files exist', () => {
    expect([...PORTRAIT_IDS].sort()).toEqual(manifest.portraits.map((p) => p.id).sort());
    for (const p of manifest.portraits) {
      const def = PORTRAITS[p.id as keyof typeof PORTRAITS];
      expect({ faction: def.faction, role: def.role, accent: def.accent }).toEqual({ faction: p.faction, role: p.role, accent: p.accent });
      expect(fs.existsSync(`${DIR}/${p.file}`)).toBe(true);
      expect(fs.existsSync(`${DIR}/${p.file2x}`)).toBe(true);
    }
  });

  it('fixed speakers use known portraits and their colours', () => {
    for (const s of Object.values(SPEAKERS)) {
      expect(PORTRAITS[s.portrait]).toBeDefined();
      expect(s.accent).toBe(PORTRAITS[s.portrait].accent);
    }
    expect(SPEAKERS.instructor.portrait).toBe('guild_instructor');
  });

  it('stations map onto the five traffic roles', () => {
    expect(trafficPortrait(trafficRole('home', 'station_home'))).toBe('traffic_home');
    expect(trafficPortrait(trafficRole('outpost', STATION_MODELS.outpost[1]!))).toBe('traffic_outpost');
    expect(STATION_MODELS.station.map((m) => trafficPortrait(trafficRole('station', m)))).toEqual(['traffic_trade', 'traffic_mining', 'traffic_research', 'traffic_research', 'traffic_trade']);
  });

  it('a captain keeps one clan portrait (a / b by the captain id), both variants are used', () => {
    const used = new Set<string>();
    for (const c of captainDefs(1337)) {
      const p = captainPortrait(c.clan, c.index);
      expect(p.startsWith(`captain_${c.clan}_`)).toBe(true);
      expect(captainPortrait(c.clan, c.index)).toBe(p);
      used.add(p);
    }
    expect(used.size).toBe(6);
    expect(captainPortrait('guild', 1)).toBe('pirate_hammer');
  });
});
