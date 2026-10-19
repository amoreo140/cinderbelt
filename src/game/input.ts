import type { PlayerCommand } from '../sim/commands';
import type { Vec2 } from '../sim/math/vec2';

export interface PointerInput {
  /** World point under the cursor. */
  aim: Vec2;
  mining: boolean;
  /** Left button – cannons (M3a). */
  firing?: boolean;
}

const NO_POINTER: PointerInput = { aim: { x: 0, y: 0 }, mining: false, firing: false };

const axis = (keys: ReadonlySet<string>, positive: string, negative: string): number =>
  (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);

/** The letter the key types (independent of the layout), or null. */
export function letterOf(code: string, key: string): string | null {
  const lower = key.toLowerCase();
  if (/^[a-z]$/.test(lower)) return lower;
  // a non-Latin layout (e.g. Cyrillic) – the letter by the physical position
  const match = /^Key([A-Z])$/.exec(code);
  return match ? match[1]!.toLowerCase() : null;
}

/** Key of a one-shot action for a letter (e.g. `key:z`). */
export const letterKey = (letter: string): string => `key:${letter}`;

/**
 * Turns the keyboard and mouse state into a command for the simulation.
 * `pressed` holds KeyboardEvent.code (movement by the key's position),
 * `justPressed` also the letters `key:<letter>` (actions by the key's label).
 */
export function buildCommand(
  pressed: ReadonlySet<string>,
  justPressed: ReadonlySet<string>,
  pointer: PointerInput = NO_POINTER,
): PlayerCommand {
  return {
    flight: {
      forward: axis(pressed, 'KeyW', 'KeyS'),
      strafe: axis(pressed, 'KeyQ', 'KeyE'),
      turn: axis(pressed, 'KeyA', 'KeyD'),
    },
    toggleDampers: justPressed.has(letterKey('z')),
    emergency: justPressed.has(letterKey('h')),
    aim: pointer.aim,
    mining: pointer.mining,
    fire: pointer.firing ?? false,
    dock: justPressed.has(letterKey('f')),
    // Tab held: a tap = scanner pulse, holding = analysis (M3.5b)
    scan: pressed.has('Tab') || justPressed.has('Tab'),
    // T: tractor beam lock / release (M3.6)
    tractor: justPressed.has(letterKey('t')),
    actions: [],
  };
}

/** An event from a text field – the game does not handle it. */
function fromEditable(e: Event): boolean {
  const t = e.target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!t || typeof t !== 'object') return false;
  return t.isContentEditable === true || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
}

/** Tracks held keys and new presses since the last consume. */
export class KeyboardState {
  readonly pressed = new Set<string>();
  private justPressed = new Set<string>();
  /** New presses with Shift (even when Shift is released before the frame handles them). */
  private shifted = new Set<string>();
  private lastShifted = new Set<string>();

  attach(target: EventTarget, signal?: AbortSignal): void {
    target.addEventListener(
      'keydown',
      (event) => {
        const e = event as KeyboardEvent;
        if (fromEditable(e)) return;
        if (e.code === 'Tab') e.preventDefault();
        this.pressed.add(e.code);
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        this.justPressed.add(e.code);
        const letter = letterOf(e.code, e.key ?? '');
        if (letter) this.justPressed.add(letterKey(letter));
        // the layout-independent letter code too (Shift+M in the shipyard)
        if (e.shiftKey) {
          this.shifted.add(e.code);
          if (letter) this.shifted.add(letterKey(letter));
        }
      },
      { signal },
    );
    // keyup is always handled so a key never stays "stuck"
    target.addEventListener('keyup', (e) => this.pressed.delete((e as KeyboardEvent).code), { signal });
    target.addEventListener('blur', () => this.pressed.clear(), { signal });
  }

  consumeJustPressed(): Set<string> {
    const result = this.justPressed;
    this.justPressed = new Set();
    this.lastShifted = this.shifted;
    this.shifted = new Set();
    return result;
  }

  /** Was the key from the last consumeJustPressed() pressed with Shift? */
  wasShifted(code: string): boolean {
    return this.lastShifted.has(code);
  }
}

/**
 * Cursor position (window pixels) and the held mouse buttons. A release counts outside the canvas too
 * (over the UI, outside the window) – otherwise firing or mining would stay "stuck". After release()
 * (pause, death, dock) a button must be pressed again; holding it is not enough.
 */
export class PointerState {
  x = 0;
  y = 0;
  private buttons = 0;
  /** The button was pressed (anywhere in the window) after the last release() and not released yet. */
  private armed = false;

  attach(element: EventTarget, signal?: AbortSignal, win: EventTarget = window): void {
    const move = (event: Event) => {
      const e = event as PointerEvent;
      this.x = e.clientX;
      this.y = e.clientY;
      // over the canvas the buttons of the event count if the player pressed them after the last
      // release() (over the UI too – e.g. an alert band appeared under the cursor); holding is not enough
      this.buttons = this.armed || this.buttons !== 0 ? e.buttons : 0;
    };
    const press = (event: Event) => {
      if ((event as PointerEvent).buttons !== 0) this.armed = true;
    };
    const down = (event: Event) => {
      const e = event as PointerEvent;
      this.x = e.clientX;
      this.y = e.clientY;
      this.buttons = e.buttons;
    };
    const up = (event: Event) => {
      const buttons = (event as PointerEvent).buttons;
      this.buttons &= buttons;
      if (buttons === 0) this.armed = false;
    };
    element.addEventListener('pointermove', move, { signal });
    element.addEventListener('pointerdown', down, { signal });
    element.addEventListener('pointerup', up, { signal });
    win.addEventListener('pointerdown', press, { signal });
    win.addEventListener('pointerup', up, { signal });
    win.addEventListener('pointercancel', () => this.release(), { signal });
    win.addEventListener('blur', () => this.release(), { signal });
  }

  /** Releases every button (pause, death, dock / undock) – a held button must be pressed again. */
  release(): void {
    this.buttons = 0;
    this.armed = false;
  }

  get left(): boolean {
    return (this.buttons & 1) !== 0;
  }

  get right(): boolean {
    return (this.buttons & 2) !== 0;
  }
}
