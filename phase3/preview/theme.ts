import { useSyncExternalStore } from "react";
import { DEFAULT_THEME,THEMES,scaleType,type ThemeId } from "../../apps/mobile/lib/palette";
export { layout,radius,space,type } from "../../apps/mobile/lib/palette";
export function usePalette(){const chosen=new URL(location.href).searchParams.get("theme") as ThemeId;return (THEMES[chosen]??THEMES[DEFAULT_THEME]).palette;}
const subscribe=(f:()=>void)=>{window.addEventListener("resize",f);return ()=>window.removeEventListener("resize",f);};
export function useType(){const width=useSyncExternalStore(subscribe,()=>window.innerWidth,()=>390);return scaleType(width,true);}
