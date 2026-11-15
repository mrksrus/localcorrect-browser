// Builds dist/localcorrect-firefox.zip and dist/localcorrect-chrome.zip from extension/.
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
// Release name (2.0.0-rc.1); browsers need a plain number, so the manifest has 1.99.1 for RCs.
const {version} = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('build', {recursive: true, force: true});
mkdirSync('dist', {recursive: true});
for (const browser of ['firefox', 'chrome']) {
  const dir = `build/${browser}`;
  cpSync('extension', dir, {recursive: true});
  cpSync('LICENSE', `${dir}/LICENSE`);
  cpSync('THIRD_PARTY.md', `${dir}/THIRD_PARTY.md`);
  cpSync('licenses', `${dir}/licenses`, {recursive: true});
  if (browser === 'chrome') {
    const m = structuredClone(manifest);
    delete m.browser_specific_settings;
    m.background = {service_worker: 'background.js', type: 'module'};
    m.minimum_chrome_version = '120';
    m.version_name = version;
    writeFileSync(`${dir}/manifest.json`, JSON.stringify(m, null, 2) + '\n');
  }
  const zip = `${process.cwd()}/dist/localcorrect-${browser}-${version}.zip`;
  rmSync(zip, {force: true});
  execFileSync('python3', ['-c', `import pathlib,shutil;shutil.make_archive(${JSON.stringify(zip.slice(0, -4))},'zip',${JSON.stringify(dir)})`]);
  console.log(zip);
}
