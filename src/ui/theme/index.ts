// The Cinderbelt design language – one entry point for styles and components.
// Rules: the "Hull language" design system (Jazyk trupu).
// Archivo with a width axis (wdth 62–125 %): narrow stencil labels and wide headings in one font
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/atkinson-hyperlegible-next';
import './tokens.css';
import './components.css';
import './discovery.css';

export { Button, Key, KeyHint, Segmented, type ButtonProps, type ButtonVariant } from './Button';
export { Callout, CalloutLayer, CALLOUT_OFFSET, type CalloutItem } from './Callout';
export { KnowledgeGraph, type GraphNodeItem, type KnowledgeGraphProps } from './KnowledgeGraph';
export { Credits, PartChip, ResourceChip, ResourceIcon, RingBadge } from './Chips';
export { ContractSlip, type ContractSlipProps, type SlipTag } from './ContractSlip';
export { Gauge, gaugeLevel, Lamp, litSegments, Readout, sameGaugeProps, type GaugeKind, type GaugeLevel, type GaugeProps } from './Meters';
export { Modal, type ModalProps } from './Modal';
export { Odometer, type OdometerProps } from './Odometer';
export { Heading, Panel, Seam, type PanelMaterial, type PanelProps } from './Panel';
export { ShipSilhouette, type ShipSilhouetteProps } from './ShipSilhouette';
export { TabRail, type TabDef } from './Tabs';
export { ToastView, type ToastTone } from './Toast';
export { Term, Tooltip, TooltipLayer, useTip } from './Tooltip';
export { FONTS, PALETTE, RING_ACCENTS, ringAccent, STATION_COLORS } from './tokens';
