import { Easing } from "react-native";
import { layout, type } from "../../lib/theme";

/**
 * Values the input kit adds to the design tokens in lib/palette.ts and lib/motion.ts. Each is derived from a token
 * where one fits; the rest carry the reason for their number.
 */

/** The send button and the chips: 50 pt, past the HIG's 44 pt minimum tap target. */
export const TARGET = layout.control.chip;

/** Focus treatment: the border warms from `line` to `ink` in 150 ms and cools in 100 ms (exits run faster). */
export const FOCUS = { inMs: 150, outMs: 100 };

/** Error under a field: it opens on spring.snap and closes in 120 ms; the line rises 4 pt as it fades in. */
export const ERROR = { outMs: 120, rise: 4 };

/** Space from the home indicator up to a docked action at rest; the 20 inside layout.dockHeight. */
export const DOCK_REST_GAP = 20;
/** Space from the keyboard's top edge up to a docked action while typing. */
export const DOCK_KEYBOARD_GAP = layout.stack.base;
/** The fade above a docked action, so content dissolves before it reaches the button (layout.dockHeight's 48). */
export const DOCK_FADE = layout.dockHeight(0) - layout.control.primary - DOCK_REST_GAP;

/** Space kept between a focused field and the keyboard, the dock or the header when it is scrolled into view. */
export const REVEAL_MARGIN = layout.stack.base;

/**
 * iOS moves the keyboard on UIKit's private curve 7, which Animated can't name; this is its usual bezier
 * approximation. The duration always comes from the keyboard's own event.
 */
export const KEYBOARD_CURVE = Easing.bezier(0.38, 0.7, 0.125, 1);
/** Android reports no duration: its IME inset animation is 285 ms on PathInterpolator(0.2, 0, 0, 1). */
export const ANDROID_IME = { ms: 285, curve: Easing.bezier(0.2, 0, 0, 1) };

/**
 * The wrong-code shake: one impulse into an underdamped spring (damping ratio 0.15, a 150 ms period), so it swings
 * about 6 pt and dies away over three decaying oscillations in roughly 450 ms.
 */
export const SHAKE = { stiffness: 1800, damping: 12.7, mass: 1, velocity: 330, restDisplacementThreshold: 0.3, restSpeedThreshold: 8 };

/** Code boxes: as tall as the primary button, so the row and the button below read as one block. */
export const CODE_BOX = layout.control.primary;
/** A digit lands from 84% scale and settles on spring.snap; it fades in over 120 ms. */
export const DIGIT = { fromScale: 0.84, fadeMs: 120 };
/** The code caret: a 2 x 24 bar that breathes between full and 25% on the AgentDot's 600 ms half-cycle. */
export const CARET = { width: 2, height: 24, low: 0.25, halfMs: 600 };
/** Digits clear after a wrong code by fading out in 120 ms (an exit, so faster than the 150 ms focus). */
export const CLEAR_MS = 120;
/** While a code is being checked the digits breathe between full and 45%. */
export const CHECKING_LOW = 0.45;
/** The code's one real input sits over the boxes nearly invisible: UIKit stops hit-testing views under 0.01 alpha. */
export const HIDDEN_INPUT_OPACITY = 0.02;

/** The composer grows to five lines, then scrolls inside itself. */
export const COMPOSER_LINES = 5;
/** Vertical padding that centres one body line in a primary-height capsule. */
export const COMPOSER_PAD_Y = (layout.control.primary - type.body.lineHeight) / 2;
/** Inset of the 50 pt send button inside the 56 pt capsule. */
export const COMPOSER_INSET = (layout.control.primary - TARGET) / 2;
/** Inset of the idle action, the 44 pt mic, so it sits centred where the send button will. */
export const COMPOSER_IDLE_INSET = (layout.control.primary - layout.control.icon) / 2;
/** Shrinking back after a send is an exit: 150 ms on ease.out (growth uses spring.snap). */
export const COMPOSER_SHRINK_MS = 150;

/** The send arrow: the lux line icon at 22 pt, about the size of the drawn arrow it replaces. */
export const ICON = { size: 22 };
