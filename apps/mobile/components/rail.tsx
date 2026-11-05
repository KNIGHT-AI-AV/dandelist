import type { ReactNode } from "react";
import { Platform, ScrollView, type ScrollViewProps } from "react-native";
import { usePageSwipe } from "./home/pager";

/**
 * A row that scrolls sideways: photos to pick, cards to compare. Inside the ring of pages it keeps its swipe: a
 * sideways drag that starts on it scrolls it and never turns the pages (owner, 2026-11-05: "When I swipe options it
 * swipes screens!"), and on the web a trackpad's sideways scroll over it stays with it too.
 */
export function Rail({ children, ...props }: ScrollViewProps & { children?: ReactNode }) {
  const pages = usePageSwipe();
  const hold = (on: boolean) => () => pages?.hold(on);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      {...props}
      onTouchStart={hold(true)}
      onTouchEnd={hold(false)}
      onTouchCancel={hold(false)}
      {...(Platform.OS === "web" ? ({ dataSet: { rail: "1" } } as object) : null)}
    >
      {children}
    </ScrollView>
  );
}
