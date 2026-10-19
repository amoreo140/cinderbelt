// Sectors over the rings (the sectors design) – public surface.
export * from './constants';
export { regionAt, regionField, freshRegionField, powerDistance, type RegionField, type RegionSeed } from './field';
export { neighbours, sharesBorder, adjacencyGraph, ADJACENCY_SAMPLE_STEP } from './adjacency';
export { guildLanes, laneDistance, inCorridor, polylineDistance, type GuildLane, type LaneId } from './lanes';
export { rollSecurity, groupMultiplier, balanceDepth, exposure, regionHash, type BalanceReport } from './security';
export {
  regionWorld,
  buildRegionWorld,
  defaultRegionInputs,
  securityOf,
  currentSecurity,
  pirateGroupRate,
  chunkPirates,
  dangerousAt,
  STATIC_SPAWN_CONTEXT,
  NO_SECURITY_OVERRIDES,
  type ChunkPirates,
  type FixedReason,
  type RegionWorld,
  type RegionInfo,
  type RegionInputs,
  type RegionLandmark,
  type SpawnContext,
  type SecurityOverrides,
} from './world';
export {
  MAP_TILE,
  MAP_LEVELS,
  buildLabelTile,
  buildLabelTileFor,
  regionMask,
  regionPolygon,
  maskOutline,
  pointInPolygon,
  polygonArea,
  type LabelTile,
  type RegionMask,
} from './grid';
export { borderOrientation, depthBorderSpread, startMapReport, pickVariant } from './metrics';
export {
  BIOMES_BY_DEPTH,
  SECTOR_NAME_WORDS,
  sectorIdAt,
  sectorInfo,
  sectorInfoAt,
  sectorInfoOfChunk,
  sectorSecurity,
  sectorThreat,
  isDangerousSecurity,
  guildCorridorAt,
  sectorLanes,
  type Biome,
  type SectorInfo,
  type SectorName,
  type Threat,
} from './sectors';
export {
  chartThreshold,
  chartingData,
  chartedByCoverage,
  knowledgeOf,
  newlyCharted,
  ownChart,
  sectorChunkKeys,
  sectorCoverage,
  sectorKnowledge,
  surveyDone,
  trainingChartSector,
  trainingWithholds,
  type KnowledgeSource,
  type SectorCoverage,
} from './knowledge';
export { surveyPoints, surveyPointsNear, surveyMask, surveyPointCount, type SurveyAnchor, type SurveyPoint } from './survey';
export { createRegionsState, type RegionsState } from './state';
