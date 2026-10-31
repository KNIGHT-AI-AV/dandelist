import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWindowDimensions, type ScaledSize } from "react-native";

const Ctx = createContext<{ width: number; height: number } | null>(null);

/** Content inside lays out at this size instead of the window's: one page of a spread (lib/spread.ts). */
export function PageSizeProvider({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const value = useMemo(() => ({ width, height }), [width, height]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The size a page's content lays out at: the window's, or in a spread its own page's, a phone's width rather than the
 * whole of the iPhone Duo's inner screen. Gutters, columns and the type scale read this. On the web the window is the
 * one lib/viewport.ts leaves after its zoom.
 */
export function usePageSize(): ScaledSize {
  const win = useWindowDimensions();
  const own = useContext(Ctx);
  return own ? { ...win, width: own.width, height: own.height } : win;
}
