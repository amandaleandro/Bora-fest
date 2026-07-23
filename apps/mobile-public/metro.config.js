// Metro (bundler do Expo/RN) tem resolução de módulos própria, diferente do
// Node — sem isto, ele não encontra pacotes hoisted pelo pnpm num monorepo
// (erro real encontrado ao rodar `expo export` neste projeto: "Unable to
// resolve module ./node_modules/expo/AppEntry.js", mesmo o Node resolvendo
// o caminho perfeitamente via symlink).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
