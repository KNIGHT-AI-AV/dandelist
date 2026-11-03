import { useEffect, useSyncExternalStore } from "react";
import { getListSort, isListSort, setListSort, subscribeListSort, type ListSort } from "./list-sort";
import { getSecret, setSecret } from "./storage";

/** The list's sort chips remember their choice on this device (lib/list-sort.ts holds the choice itself). */
const KEY = "dandelist.listSort";
let loaded = false;

subscribeListSort((sort) => void setSecret(KEY, sort ? JSON.stringify(sort) : null).catch(() => {}));

/** The sort on screen, read from the device once per app start. */
export function useListSort(): ListSort {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    const before = getListSort();
    void getSecret(KEY)
      .then((raw) => {
        const v: unknown = raw ? JSON.parse(raw) : null;
        // A tap made while this read was out wins over the stored choice.
        if (isListSort(v) && getListSort() === before) setListSort(v);
      })
      .catch(() => {});
  }, []);
  return useSyncExternalStore(subscribeListSort, getListSort, getListSort);
}
