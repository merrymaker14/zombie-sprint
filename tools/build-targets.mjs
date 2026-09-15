import fs from 'fs';
import path from 'path';
import { buildTargets } from 'game-kit/build';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const argv = process.argv.slice(2);
const arg = (name) => {
  const hit = argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const only = arg('target') ? [arg('target')] : pkg.targets;
const result = buildTargets({
  root,
  only,
  cloudKeys: pkg.cloudKeys,
  localKeys: pkg.localKeys,
  gdId: arg('gd-id') || pkg.gdGameId || '',
  vkAppId: pkg.vkAppId || '',
  libs: {
    vkok: [
      ['node_modules/@vkontakte/vk-bridge/dist/browser.min.js', 'vk-bridge.min.js'],
      ['node_modules/game-kit/platform/vkok-boot.js', 'vkok-boot.js'],
    ],
    yandex: [['node_modules/game-kit/platform/yandex-boot.js', 'yandex-boot.js']],
    crazy: [['node_modules/game-kit/platform/crazy-boot.js', 'crazy-boot.js']],
  },
});

if (result.failed.length) {
  console.error(`\n${result.failed.length} сборок не прошли проверку`);
  process.exit(1);
}
console.log(`\nсборки готовы: ${result.built.join(', ')}`);
