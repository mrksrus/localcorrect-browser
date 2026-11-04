const api = globalThis.browser || globalThis.chrome;
const names = ['correct-text', 'undo-correction'];
const $ = id => document.getElementById(id);
async function show() {
  for (const command of await api.commands.getAll()) if (names.includes(command.name)) $(command.name).value = command.shortcut || '';
}
if (!api.commands.update) {
  for (const id of [...names, 'save', 'reset']) $(id).disabled = true;
  $('hint').textContent = 'Chrome manages extension shortcuts at chrome://extensions/shortcuts. You can edit both LocalCorrect commands there.';
  $('browser-settings').hidden = false;
  $('browser-settings').onclick = () => api.tabs.create({url: 'chrome://extensions/shortcuts'});
}
$('shortcuts').onsubmit = async event => {
  event.preventDefault();
  const old = await api.commands.getAll(), next = Object.fromEntries(names.map(name => [name, $(name).value.trim()]));
  if (next[names[0]] && next[names[0]] === next[names[1]]) {$('status').textContent = 'Use different shortcuts for correction and Undo.'; return;}
  try {
    for (const name of names) await api.commands.update({name, shortcut: next[name]});
    await api.storage.local.set({shortcuts: next});
    $('status').textContent = 'Shortcuts saved locally.';
  } catch (error) {
    for (const command of old) if (names.includes(command.name)) {try {await api.commands.update({name: command.name, shortcut: command.shortcut});} catch {}}
    $('status').textContent = `Could not save: ${error.message}`;
  }
  await show();
};
$('reset').onclick = async () => {
  try {for (const name of names) await api.commands.reset(name); await api.storage.local.remove('shortcuts'); await show(); $('status').textContent = 'Default shortcuts restored.';}
  catch (error) {$('status').textContent = error.message;}
};
void show();
