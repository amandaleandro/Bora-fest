import { registerRootComponent } from "expo";

import App from "./App";

// Entry point próprio em vez de "expo/AppEntry.js" — aquele arquivo faz um
// import relativo ("../../App") que quebra sob os symlinks do pnpm (achado
// real ao rodar `expo export` neste monorepo: Metro resolve o symlink pro
// caminho físico dentro de node_modules/.pnpm/ e o "../../App" aponta pro
// lugar errado a partir de lá).
registerRootComponent(App);
