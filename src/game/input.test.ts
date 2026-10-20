import { describe, expect, it } from 'vitest';
import { buildCommand, KeyboardState, letterKey, letterOf, PointerState, QUESTION_HELD } from './input';

const none = new Set<string>();

interface KeyInit {
  code: string;
  key?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const keyEvent = (type: 'keydown' | 'keyup', init: KeyInit): Event =>
  Object.assign(new Event(type), { key: '', repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...init });

function setup() {
  const target = new EventTarget();
  const keyboard = new KeyboardState();
  keyboard.attach(target);
  const down = (init: KeyInit) => target.dispatchEvent(keyEvent('keydown', init));
  const up = (init: KeyInit) => target.dispatchEvent(keyEvent('keyup', init));
  return { target, keyboard, down, up };
}

describe('buildCommand', () => {
  it('is idle without input', () => {
    expect(buildCommand(none, none)).toEqual({
      flight: { forward: 0, strafe: 0, turn: 0 },
      toggleDampers: false,
      emergency: false,
      aim: { x: 0, y: 0 },
      mining: false,
      fire: false,
      dock: false,
      scan: false,
      tractor: false,
      actions: [],
    });
  });

  it('T locks or releases the tractor beam (M3.6)', () => {
    expect(buildCommand(none, new Set(['key:t'])).tractor).toBe(true);
  });

  it('holds the scanner while Tab is down (M3.5b)', () => {
    expect(buildCommand(new Set(['Tab']), none).scan).toBe(true);
  });

  it('requests docking on a fresh F press', () => {
    expect(buildCommand(new Set(['KeyF']), none).dock).toBe(false);
    expect(buildCommand(none, new Set(['key:f'])).dock).toBe(true);
  });

  it('maps WASD/QE to flight axes', () => {
    expect(buildCommand(new Set(['KeyW']), none).flight.forward).toBe(1);
    expect(buildCommand(new Set(['KeyS']), none).flight.forward).toBe(-1);
    expect(buildCommand(new Set(['KeyA']), none).flight.turn).toBe(1);
    expect(buildCommand(new Set(['KeyD']), none).flight.turn).toBe(-1);
    expect(buildCommand(new Set(['KeyQ']), none).flight.strafe).toBe(1);
    expect(buildCommand(new Set(['KeyE']), none).flight.strafe).toBe(-1);
  });

  it('cancels opposite keys', () => {
    expect(buildCommand(new Set(['KeyW', 'KeyS']), none).flight.forward).toBe(0);
  });

  it('toggles dampers and emergency only on fresh letter presses', () => {
    expect(buildCommand(new Set(['KeyZ', 'KeyH']), none).toggleDampers).toBe(false);
    expect(buildCommand(none, new Set(['key:z'])).toggleDampers).toBe(true);
    expect(buildCommand(none, new Set(['key:h'])).emergency).toBe(true);
    // the physical position of Z on QWERTY is not enough – the letter decides
    expect(buildCommand(none, new Set(['KeyZ'])).toggleDampers).toBe(false);
  });

  it('passes the pointer aim and mining button', () => {
    const cmd = buildCommand(none, none, { aim: { x: 4, y: -2 }, mining: true });
    expect(cmd.aim).toEqual({ x: 4, y: -2 });
    expect(cmd.mining).toBe(true);
    expect(cmd.fire).toBe(false);
  });

  it('fires the cannons with the left button (M3a)', () => {
    expect(buildCommand(none, none, { aim: { x: 1, y: 1 }, mining: false, firing: true }).fire).toBe(true);
  });
});

describe('letterOf', () => {
  it('uses the typed latin letter', () => {
    expect(letterOf('KeyY', 'z')).toBe('z');
    expect(letterOf('KeyY', 'Z')).toBe('z');
  });

  it('falls back to the physical key for non-latin layouts', () => {
    expect(letterOf('KeyZ', 'я')).toBe('z');
  });

  it('returns null for keys without a letter', () => {
    expect(letterOf('Digit1', '1')).toBeNull();
    expect(letterOf('Space', ' ')).toBeNull();
    expect(letterOf('ShiftLeft', 'Shift')).toBeNull();
  });
});

describe('KeyboardState', () => {
  it('holds the "?" key (any layout) while it is down, also when Shift is released first', () => {
    const { keyboard, down, up } = setup();
    // US layout: Shift + Slash
    down({ code: 'ShiftLeft', key: 'Shift', shiftKey: true });
    down({ code: 'Slash', key: '?', shiftKey: true });
    expect(keyboard.pressed.has(QUESTION_HELD)).toBe(true);
    up({ code: 'ShiftLeft', key: 'Shift' });
    expect(keyboard.pressed.has(QUESTION_HELD)).toBe(true);
    up({ code: 'Slash', key: '/' });
    expect(keyboard.pressed.has(QUESTION_HELD)).toBe(false);
    // Slovak layout: Shift + the comma key types "?"
    down({ code: 'Comma', key: '?', shiftKey: true });
    expect(keyboard.pressed.has(QUESTION_HELD)).toBe(true);
    up({ code: 'Comma', key: ',' });
    expect(keyboard.pressed.has(QUESTION_HELD)).toBe(false);
  });

  it('remembers which fresh presses came with Shift, even when Shift is released before the frame', () => {
    const { keyboard, down, up } = setup();
    down({ code: 'ShiftLeft', key: 'Shift', shiftKey: true });
    down({ code: 'Digit1', key: '!', shiftKey: true });
    up({ code: 'Digit1', key: '!' });
    up({ code: 'ShiftLeft', key: 'Shift' });
    down({ code: 'Digit2', key: '2' });
    const pressed = keyboard.consumeJustPressed();
    expect(pressed.has('Digit1')).toBe(true);
    expect(keyboard.wasShifted('Digit1')).toBe(true);
    expect(keyboard.wasShifted('Digit2')).toBe(false);
    keyboard.consumeJustPressed();
    expect(keyboard.wasShifted('Digit1')).toBe(false);
  });

  it('remembers Shift on the layout-independent letter code too (Shift+M in the shipyard)', () => {
    const { keyboard, down, up } = setup();
    down({ code: 'ShiftLeft', key: 'Shift', shiftKey: true });
    down({ code: 'KeyM', key: 'M', shiftKey: true });
    up({ code: 'KeyM', key: 'M' });
    up({ code: 'ShiftLeft', key: 'Shift' });
    expect(keyboard.consumeJustPressed().has(letterKey('m'))).toBe(true);
    expect(keyboard.wasShifted(letterKey('m'))).toBe(true);
  });

  it('tracks held keys by physical code', () => {
    const { keyboard, down, up } = setup();
    down({ code: 'KeyW', key: 'w' });
    expect(keyboard.pressed.has('KeyW')).toBe(true);
    up({ code: 'KeyW', key: 'w' });
    expect(keyboard.pressed.has('KeyW')).toBe(false);
  });

  it('does not count key repeat as a new press', () => {
    const { keyboard, down } = setup();
    down({ code: 'KeyZ', key: 'z' });
    expect(keyboard.consumeJustPressed().has('key:z')).toBe(true);
    down({ code: 'KeyZ', key: 'z', repeat: true });
    expect(keyboard.consumeJustPressed().size).toBe(0);
  });

  it('clears held keys on blur', () => {
    const { target, keyboard, down } = setup();
    down({ code: 'KeyW', key: 'w' });
    target.dispatchEvent(new Event('blur'));
    expect(keyboard.pressed.size).toBe(0);
  });

  it('toggles dampers with the Z letter on a QWERTZ layout', () => {
    const { keyboard, down } = setup();
    down({ code: 'KeyY', key: 'z' });
    expect(buildCommand(keyboard.pressed, keyboard.consumeJustPressed()).toggleDampers).toBe(true);
  });

  it('ignores actions with Ctrl, Meta or Alt', () => {
    const { keyboard, down } = setup();
    down({ code: 'KeyY', key: 'z', ctrlKey: true });
    down({ code: 'KeyH', key: 'h', metaKey: true });
    down({ code: 'KeyM', key: 'm', altKey: true });
    const just = keyboard.consumeJustPressed();
    expect(buildCommand(keyboard.pressed, just).toggleDampers).toBe(false);
    expect(just.size).toBe(0);
  });

  it('empties the fresh presses on consume', () => {
    const { keyboard, down } = setup();
    down({ code: 'KeyM', key: 'm' });
    expect(keyboard.consumeJustPressed().has('key:m')).toBe(true);
    expect(keyboard.consumeJustPressed().size).toBe(0);
  });

  it('ignores events from text inputs', () => {
    const input = Object.assign(new EventTarget(), { tagName: 'INPUT' });
    const editable = Object.assign(new EventTarget(), { tagName: 'DIV', isContentEditable: true });
    const keyboard = new KeyboardState();
    keyboard.attach(input);
    keyboard.attach(editable);
    input.dispatchEvent(keyEvent('keydown', { code: 'KeyW', key: 'w' }));
    editable.dispatchEvent(keyEvent('keydown', { code: 'KeyZ', key: 'z' }));
    expect(keyboard.pressed.size).toBe(0);
    expect(keyboard.consumeJustPressed().size).toBe(0);
  });

  it('stops listening when the signal aborts', () => {
    const target = new EventTarget();
    const controller = new AbortController();
    const keyboard = new KeyboardState();
    keyboard.attach(target, controller.signal);
    controller.abort();
    target.dispatchEvent(keyEvent('keydown', { code: 'KeyW', key: 'w' }));
    expect(keyboard.pressed.size).toBe(0);
  });
});

describe('PointerState', () => {
  const pointerEvent = (type: string, buttons: number, x = 10, y = 20): Event =>
    Object.assign(new Event(type), { clientX: x, clientY: y, buttons });

  function pointerSetup() {
    const canvas = new EventTarget();
    const win = new EventTarget();
    const pointer = new PointerState();
    const controller = new AbortController();
    pointer.attach(canvas, controller.signal, win);
    return { canvas, win, pointer, controller };
  }

  it('tracks the position and the held buttons over the canvas', () => {
    const { canvas, pointer } = pointerSetup();
    canvas.dispatchEvent(pointerEvent('pointerdown', 1, 30, 40));
    expect([pointer.x, pointer.y, pointer.left, pointer.right]).toEqual([30, 40, true, false]);
    canvas.dispatchEvent(pointerEvent('pointerup', 0));
    expect(pointer.left).toBe(false);
  });

  it('releases the buttons when the pointer is let go outside the canvas (over the UI)', () => {
    const { canvas, win, pointer } = pointerSetup();
    canvas.dispatchEvent(pointerEvent('pointerdown', 2));
    expect(pointer.right).toBe(true);
    win.dispatchEvent(pointerEvent('pointerup', 0));
    expect(pointer.right).toBe(false);
    canvas.dispatchEvent(pointerEvent('pointerdown', 1));
    win.dispatchEvent(pointerEvent('pointercancel', 0));
    expect(pointer.left).toBe(false);
  });

  it('release() drops the held buttons and a still-held button needs a fresh press over the canvas', () => {
    const { canvas, pointer } = pointerSetup();
    canvas.dispatchEvent(pointerEvent('pointerdown', 1));
    pointer.release();
    expect(pointer.left).toBe(false);
    // the button is still held (a move over the canvas reports buttons = 1) – no firing until pressed again
    canvas.dispatchEvent(pointerEvent('pointermove', 1, 50, 60));
    expect(pointer.left).toBe(false);
    expect([pointer.x, pointer.y]).toEqual([50, 60]);
    canvas.dispatchEvent(pointerEvent('pointerdown', 1));
    expect(pointer.left).toBe(true);
  });

  it('a press that started over the UI (bubbles to window) fires once the pointer moves over the canvas', () => {
    const { canvas, win, pointer } = pointerSetup();
    win.dispatchEvent(pointerEvent('pointerdown', 1));
    expect(pointer.left).toBe(false);
    canvas.dispatchEvent(pointerEvent('pointermove', 1));
    expect(pointer.left).toBe(true);
    // a click on a UI button (press and release) leaves nothing stuck
    win.dispatchEvent(pointerEvent('pointerup', 0));
    canvas.dispatchEvent(pointerEvent('pointermove', 1));
    expect(pointer.left).toBe(false);
  });

  it('accepts a chorded second button while another one is held', () => {
    const { canvas, pointer } = pointerSetup();
    canvas.dispatchEvent(pointerEvent('pointerdown', 1));
    canvas.dispatchEvent(pointerEvent('pointermove', 3));
    expect([pointer.left, pointer.right]).toEqual([true, true]);
  });

  it('releases on window blur and stops listening when the signal aborts', () => {
    const { canvas, win, pointer, controller } = pointerSetup();
    canvas.dispatchEvent(pointerEvent('pointerdown', 1));
    win.dispatchEvent(new Event('blur'));
    expect(pointer.left).toBe(false);
    controller.abort();
    canvas.dispatchEvent(pointerEvent('pointerdown', 1));
    expect(pointer.left).toBe(false);
  });
});
