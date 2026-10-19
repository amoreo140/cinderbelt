// Public API of the Cinderbelt audio module.
export { AudioEngine, DEFAULT_VOLUMES, prewarmAudioContext } from './AudioEngine';
export type {
  AudioEngineOptions,
  AudioEngineState,
  AudioVolumes,
  GestureTarget,
  ImpactOptions,
  VisibilitySource,
} from './AudioEngine';
export type { LaserInput, ThrustInput } from './loopParams';
export type { AlertKind, UiSound } from './recipes';
export type { CombatSound } from './combatRecipes';
export type { Ring } from './ambientParams';
export { MUSIC_MANIFEST_URL } from './AudioEngine';
export { MUSIC_MOODS, parseMusicManifest, stemGain } from './music/manifest';
export type { MusicManifest, MusicMood, MusicStem, MusicTrack } from './music/manifest';
export { MENU_SITUATION, MusicDirector, MUSIC_LEVELS, MUSIC_TIMING } from './music/musicDirector';
export type { MusicCommand, MusicScreen, MusicSituation } from './music/musicDirector';
export { MusicSystem } from './music/MusicSystem';
