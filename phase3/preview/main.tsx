import { createRoot } from "react-dom/client";
import { EntitlementPreview } from "../../apps/mobile/components/drafts/entitlement-preview";
import { useAppFonts } from "../../apps/mobile/lib/fonts.web";
import { usePalette } from "./theme";
import copy from "../../apps/mobile/lib/drafts/copy.json";
document.title=copy.preview.title;
function Preview(){const [loaded,error]=useAppFonts();const p=usePalette();document.body.style.background=p.bg;return loaded||error?<EntitlementPreview enabled/>:null;}
createRoot(document.getElementById("root")!).render(<Preview/>);
