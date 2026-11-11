import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
export default {
  root:fileURLToPath(new URL("./",import.meta.url)),envDir:false,
  publicDir:fileURLToPath(new URL("../../apps/mobile/public",import.meta.url)),
  resolve:{alias:[{find:"react-native",replacement:"react-native-web"},{find:/^.*\/lib\/theme$/,replacement:fileURLToPath(new URL("./theme.ts",import.meta.url))}]},
  esbuild:{jsx:"automatic"},server:{host:"127.0.0.1",port:8562,strictPort:true,fs:{allow:[root]}},
};
