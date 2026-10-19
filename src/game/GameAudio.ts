// Game sounds and music: connects the audio module (src/audio) to the simulation and the UI.
import { AudioEngine, type AudioVolumes } from '../audio';
import type { MusicScreen } from '../audio/music/musicDirector';
import type { SectorTone } from '../audio/recipes';
import type { SimEvent, SimState } from '../sim/Simulation';
import { hottest } from '../sim/mining/heat';
import { LEGACY_MUTED_KEY, readMigrated } from './storage/legacyKeys';
import { CollectTracker, impactIntensity, laserInput, thrustInput } from './audioMapping';
import { combatCue } from './combatAudio';
import { EventMoments, gameMusicSituation, HitMemory } from './musicSituation';
import { SectorZoneTracker } from './sectorZone';
import { securedSectors } from '../sim/pirates/sectors';

const MUTE_KEY = 'cinderbelt.muted';

function loadMuted(): boolean {
  try {
    return readMigrated(localStorage, MUTE_KEY, LEGACY_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // storage unavailable – the preference is just not remembered
  }
}

export interface GameAudioOptions {
  volumes?: Partial<AudioVolumes>;
  muted?: boolean;
  /** The player toggled mute with N – the app stores it in the settings. */
  onMuteChange?: (muted: boolean) => void;
}

const SILENT = { main: 0, reverse: 0, side: 0 };

export class GameAudio {
  private readonly engine: AudioEngine;
  private collect = new CollectTracker();
  private readonly hits = new HitMemory();
  /** Space events for the music (M4b): tension of a shower / an ambush lead, a discovery's mystery mood. */
  private readonly moments = new EventMoments();
  /** The player's sector (depth, frontier) with the border hysteresis – ambience and music. */
  private readonly zone = new SectorZoneTracker();
  private readonly detachUnlock: () => void;

  private readonly onMuteChange: ((muted: boolean) => void) | null;

  constructor(target: Window = window, options: GameAudioOptions = {}) {
    this.engine = new AudioEngine({ muted: options.muted ?? loadMuted(), volumes: options.volumes });
    this.onMuteChange = options.onMuteChange ?? null;
    this.detachUnlock = this.engine.attachUnlock(target);
    this.engine.startAmbient(1);
    // the graph is built in idle time now, so the first click or key only resumes the context
    this.engine.prepare();
  }

  get muted(): boolean {
    return this.engine.isMuted;
  }

  toggleMute(): boolean {
    const muted = this.engine.toggleMute();
    if (this.onMuteChange) this.onMuteChange(muted);
    else saveMuted(muted);
    return muted;
  }

  /** Volumes and mute from the Settings. */
  configure(volumes: AudioVolumes, muted: boolean): void {
    this.engine.setVolumes(volumes);
    this.engine.setMuted(muted);
  }

  /** Silences the ship's continuous sounds (pause, back to the menu); ambience and music go on. */
  silence(): void {
    this.engine.setThrust(SILENT);
    this.engine.setMiningLaser({ active: false, hitting: false, resource: null });
    // the audio belongs to the app and outlives the game – it must not hold a finished simulation (the next frame restores it)
    this.state = null;
  }

  /**
   * A new game or a loaded save starts: the audio is app-owned and outlives games, so per-game
   * memory (recent hits on the player, the collected-cargo baseline) must not leak into the next one.
   */
  newGame(): void {
    this.hits.reset();
    this.moments.reset();
    this.zone.reset();
    this.collect = new CollectTracker();
    this.state = null;
  }

  /** Continuous sounds and the music situation – called every frame. */
  frame(state: SimState): void {
    const player = state.player;
    const flying = player.dock.mode === 'flying';
    this.engine.setThrust(flying ? thrustInput(player.lastLocalForce, player.props) : SILENT);
    const laser = laserInput(flying ? player.beams : [], hottest(player.heat).fraction);
    this.engine.setMiningLaser(laser);
    for (const resource of this.collect.update(player.cargo, flying && laser.hitting)) {
      this.engine.playResourceCollected(resource);
    }
    // ambience and music follow the player's sector (its depth; the frontier = unguarded depth ≥ 2)
    const zone = this.zone.update(state.seed, player.body.pos);
    this.engine.setAmbientRing(zone.depth);
    // frames run only in live play (pause and menus stop the loop), so this is the 'game' screen
    const music = gameMusicSituation(state, this.hits.recent(state.tick), { depth: zone.depth, frontier: this.zone.frontier(securedSectors(state)) }, this.moments.moments(state.tick));
    this.engine.setMusicSituation({ screen: 'game', ...music });
    this.state = state;
  }

  /** Last state from a frame – listener position and asteroid lookup for combat sounds. */
  private state: SimState | null = null;

  event(event: SimEvent): void {
    if (this.state) {
      this.hits.note(event, this.state.tick);
      this.moments.note(event, this.state.tick);
    }
    switch (event.type) {
      case 'collision':
        this.engine.playImpact(impactIntensity(event.speed));
        break;
      case 'cargoFull':
        this.engine.playAlert('cargoFull');
        break;
      case 'outOfFuel':
        this.engine.playAlert('outOfFuel');
        break;
      case 'dampersToggled':
        this.engine.playDampers(event.on);
        break;
      case 'dockingStarted':
      case 'towed':
        this.engine.playDock();
        break;
      case 'undocked':
        this.engine.playUndock();
        break;
      case 'nuggetCollected':
        // the ore chime of mining plus the pickup clunk (combat cue)
        this.engine.playResourceCollected(event.resource);
        this.playCue(event);
        break;
      default:
        // combat (M3a): shots, hits, explosions, asteroid breakup, loot
        this.playCue(event);
        break;
    }
  }

  private playCue(event: SimEvent): void {
    const state = this.state;
    const cue = combatCue(event, state?.player.body.pos ?? { x: 0, y: 0 }, (id) => state?.world.findAsteroid(id)?.resource ?? null);
    if (cue) this.engine.playCombat(cue.kind, cue);
  }

  /** Collision ahead (M3.8): one short beep; the caller paces them by urgency. */
  collisionBeep(urgency: number): void {
    this.engine.playCombat('collisionWarning', { intensity: urgency, gain: 1, pan: 0 });
  }

  /** The app's screen for the music (main menu, pause, death card…). */
  setMusicScreen(screen: MusicScreen): void {
    this.engine.setMusicSituation({ screen });
  }

  click(): void {
    this.engine.playUi('click');
  }

  /** A radio message opens (communicator): static bleep, a subtle music duck for danger and story. */
  comms(kind: 'radio' | 'danger' | 'echo', duck: boolean): void {
    this.engine.playComms(kind, duck);
  }

  hover(): void {
    this.engine.playUi('hover');
  }

  /** The ship entered a sector (sectors §5.2): the security's own chime, the full one on a first visit. */
  sectorEntry(security: SectorTone, notice: boolean): void {
    this.engine.playSectorEntry(security, notice);
  }

  dispose(): void {
    this.detachUnlock();
    this.engine.dispose();
  }
}
