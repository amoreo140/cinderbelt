import { Button, type ButtonProps } from '../theme';

/** What the hub buttons need: the click sound before an action. */
export interface ClickSound {
  click(): void;
}

/** Hub button – clicks before the action. */
export function Act(p: Omit<ButtonProps, 'onClick'> & { on: ClickSound; onClick: (e: MouseEvent) => void }) {
  const { on, onClick, ...rest } = p;
  return (
    <Button
      {...rest}
      onClick={(e) => {
        on.click();
        onClick(e);
      }}
    />
  );
}
