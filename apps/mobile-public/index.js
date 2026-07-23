import { registerRootComponent } from "expo";

import App from "./App";

// Ver apps/mobile-checkin/index.js: entry point próprio em vez de
// "expo/AppEntry.js" (aquele quebra sob os symlinks do pnpm).
registerRootComponent(App);
