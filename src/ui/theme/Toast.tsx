import { Lamp } from './Meters';

export type ToastTone = 'info' | 'ok' | 'error';

const LAMP = { info: 'info', ok: 'ok', error: 'bad' } as const;

/** A short message – a band with a signal light (green success, red error). */
export function ToastView({ kind, text, testId }: { kind: ToastTone; text: string; testId?: string }) {
  return (
    <div class={`af-toast af-toast--${kind}`} role={kind === 'error' ? 'alert' : 'status'} data-testid={testId} key={text}>
      <Lamp state={LAMP[kind]} />
      <span>{text}</span>
    </div>
  );
}
