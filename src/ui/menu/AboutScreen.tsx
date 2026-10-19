import { tx } from '../../i18n';
import { assetUrl } from '../../render/assets/url';
import { splitKeyLabel } from '../keyLabel';
import { Heading, KeyHint, Panel } from '../theme';
import { Sheet } from './Sheet';
import type { OverlayData, OverlayHandlers } from './types';

const t = () => tx().app.about;

export function AboutScreen({ data, on }: { data: OverlayData; on: OverlayHandlers }) {
  return (
    <Sheet title={t().title} onBack={on.back} narrow testId="about">
      <img class="ab-logo" src={assetUrl('assets/ui/logo_small.png')} alt="Cinderbelt" />
      <p class="ab-lead">{t().lead}</p>
      <p class="ab-text">{t().saves}</p>
      <Heading>{t().controls}</Heading>
      <Panel material="screen" cut="md" class="ab-keys">
        {tx().help.lines.map((line) => {
          const parsed = splitKeyLabel(line);
          return parsed ? (
            <KeyHint key={line} keys={parsed.keys} dark>
              {parsed.text}
            </KeyHint>
          ) : (
            <span key={line}>{line}</span>
          );
        })}
      </Panel>
      <p class="pl-hint">
        {t().tech} {tx().app.menu.version(data.version)}
      </p>
    </Sheet>
  );
}
