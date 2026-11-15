const api = globalThis.browser || globalThis.chrome;
const language = document.getElementById('language');
const status = document.getElementById('status');

api.storage.local.get('language').then(({language: value = 'auto'}) => { language.value = value; });
language.addEventListener('change', () => api.storage.local.set({language: language.value}));

api.storage.session?.get('last').then(({last}) => {
  if (!last) return;
  status.textContent = last.error || (last.undone ? 'Last correction undone.'
    : last.changed ? `Last run fixed ${last.changed}: ${last.edits.map(([a, b]) => `${a} → ${b}`).join(', ')}` : 'Last run: no typos found.');
});

// The popup closes first so the page gets its focus back before the text is edited.
for (const action of ['correct', 'undo']) document.getElementById(action).addEventListener('click', async () => {
  await api.runtime.sendMessage({type: 'localcorrect-run', action});
  window.close();
});
