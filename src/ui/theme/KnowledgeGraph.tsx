// KnowledgeGraph (the long-term design, 10.3, 5.6): a recessed display, nodes = small plates with cut
// corners, 1 px edges (`--af-screen-line`) with a clue arrow. ✱ = info light (there is something more here),
// ? = template tag (a clue leads here but the player has not seen the place yet), selection = focus line.
import { Lamp } from './Meters';

export interface GraphNodeItem {
  id: string;
  title: string;
  /** Node kind (the tag on the plate): place, topic, observation. */
  kindLabel: string;
  kind: 'place' | 'topic' | 'observation';
  known: boolean;
  more: boolean;
  col: number;
  row: number;
}

export interface KnowledgeGraphProps {
  nodes: readonly GraphNodeItem[];
  edges: readonly [string, string][];
  selected: string | null;
  onSelect(id: string): void;
  /** Grid cell size (px). */
  cell?: { w: number; h: number };
  label: string;
  moreLabel: string;
  unknownLabel: string;
}

const NODE = { w: 112, h: 44 };

export function KnowledgeGraph(p: KnowledgeGraphProps) {
  const cell = p.cell ?? { w: 126, h: 62 };
  const cols = Math.max(1, ...p.nodes.map((n) => n.col + 1));
  const rows = Math.max(1, ...p.nodes.map((n) => n.row + 1));
  const width = cols * cell.w;
  const height = rows * cell.h;
  const at = new Map(p.nodes.map((n) => [n.id, n]));
  const center = (n: GraphNodeItem) => ({ x: n.col * cell.w + cell.w / 2, y: n.row * cell.h + cell.h / 2 });
  return (
    <div class="af-graph" role="group" aria-label={p.label} data-testid="knowledge-graph">
      <div class="af-graph-plane" style={{ width: `${width}px`, height: `${height}px` }}>
        <svg class="af-graph-edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <defs>
            <marker id="af-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" />
            </marker>
          </defs>
          {p.edges.map(([a, b]) => {
            const na = at.get(a);
            const nb = at.get(b);
            if (!na || !nb) return null;
            const s = center(na);
            const t = center(nb);
            // the edge ends at the border of the target plate
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const k = Math.min(dx === 0 ? Infinity : NODE.w / 2 / Math.abs(dx), dy === 0 ? Infinity : NODE.h / 2 / Math.abs(dy));
            const sx = s.x + dx * Math.min(k, 0.5);
            const sy = s.y + dy * Math.min(k, 0.5);
            const ex = t.x - dx * Math.min(k, 0.5);
            const ey = t.y - dy * Math.min(k, 0.5);
            return <line key={`${a}>${b}`} class={nb.known ? '' : 'is-lead'} x1={sx} y1={sy} x2={ex} y2={ey} marker-end="url(#af-graph-arrow)" />;
          })}
        </svg>
        {p.nodes.map((n) => {
          const c = center(n);
          return (
            <button
              type="button"
              key={n.id}
              class={`af-graph-node af-focusable af-graph-node--${n.kind}${n.known ? '' : ' is-unknown'}${p.selected === n.id ? ' is-selected' : ''}`}
              style={{ left: `${c.x - NODE.w / 2}px`, top: `${c.y - NODE.h / 2}px`, width: `${NODE.w}px`, height: `${NODE.h}px` }}
              aria-pressed={p.selected === n.id}
              disabled={!n.known}
              data-testid={`graph-${n.id}`}
              onClick={() => p.onSelect(n.id)}
            >
              {n.known ? (
                <>
                  <span class="af-label af-graph-kind">{n.kindLabel}</span>
                  <span class="af-graph-title">{n.title}</span>
                  {n.more && (
                    <span class="af-graph-more" title={p.moreLabel}>
                      <Lamp state="info" label={p.moreLabel} />
                    </span>
                  )}
                </>
              ) : (
                <span class="af-label af-graph-unknown" title={p.unknownLabel}>
                  ?
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
