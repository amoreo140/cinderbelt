// M4d: the map gains the `convoys` (Guild layer) and `notes` layers. T0 kept them hidden until their
// drawing landed; T12 drew them – all eight layers are on the toolbar with the digit keys 1–8.
import { describe, expect, it } from 'vitest';
import { ExploreUi, MAP_LAYERS, PENDING_MAP_LAYERS, type ExploreUiHost } from './exploreUi';

describe('map layers', () => {
  it('shows every layer, the M4d ones last so the older keys keep their digits', () => {
    expect(PENDING_MAP_LAYERS.size).toBe(0);
    expect(MAP_LAYERS).toEqual(['stations', 'signals', 'places', 'contracts', 'fields', 'sectors', 'convoys', 'notes']);
  });

  it('toggles layers 7 and 8 with their digits while the map is open', () => {
    const host = { render: () => {}, send: () => 0, click: () => {} } as unknown as ExploreUiHost;
    const ui = new ExploreUi(host);
    const letter = (l: string) => `key:${l}`;
    expect(ui.onKey('Digit7', letter, true)).toBe(true);
    expect(ui.layers.convoys).toBe(false);
    expect(ui.onKey('Digit8', letter, true)).toBe(true);
    expect(ui.layers.notes).toBe(false);
    expect(ui.onKey('Digit9', letter, true)).toBe(false);
    expect(ui.onKey('Digit7', letter, false)).toBe(false);
    expect(ui.layers.convoys).toBe(false);
  });
});
