// Present each existing video select as a table while retaining its change handlers.
function videoFilenameFields(name) {
  // Older recordings may have no number and may put the comment after the dimensions.
  const match = name.match(/^(?:(\d+)_)?(.*?)?(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(\d+h\d+m\d+s)_(\d+x\d+)(?:_(.*?))?\.[^.]+$/i);
  if (!match) return ['—', name, '—', '—', '—', '—', '—'];
  const time = value => value.replace(/-/g, ':');
  const prefix = (match[2] || '').replace(/_$/, '');
  const suffix = match[9] && !/^\d+$/.test(match[9]) ? match[9] : '';
  return [match[1] || '—', [prefix, suffix].filter(Boolean).join(' ') || '—', match[3], time(match[4]), (match[5] === match[3] ? '' : match[5] + ' ') + time(match[6]), match[7], match[8].replace(/x/i, ' × ')];
}
for (const id of ['libraryFile', 'editFile', 'videoTrackFile', 'processFile']) {
  const select = document.getElementById(id);
  const picker = document.createElement('div'); picker.className = 'video-picker';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'input video-picker-toggle'; toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.className = 'video-picker-panel'; panel.hidden = true;
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const title of ['Number', 'Comment', 'Date', 'Start time', 'End time', 'Duration', 'Resolution']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = title; head.append(th); }
  const body = table.createTBody(); panel.append(table); select.before(picker); picker.append(toggle, panel, select);
  select.classList.add('video-picker-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  function close() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  function render() {
    toggle.disabled = select.disabled;
    toggle.textContent = select.selectedOptions[0]?.textContent || 'Select a video';
    toggle.title = select.value;
    body.replaceChildren();
    for (const option of select.options) {
      if (!option.value) continue;
      const row = body.insertRow(); row.className = 'video-picker-row';
      const fields = videoFilenameFields(option.value);
      fields.forEach((field, index) => {
        const cell = row.insertCell();
        if (index === 0) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'video-picker-row-button';
          button.setAttribute('aria-label', option.value); button.setAttribute('aria-pressed', String(option.value === select.value));
          button.onclick = () => { select.value = option.value; select.dispatchEvent(new Event('change', {bubbles:true})); render(); close(); toggle.focus(); };
          cell.append(button);
        }
        const text = document.createElement('span'); text.textContent = field; cell.append(text);
      });
      row.title = option.value;
      if (option.value === select.value) row.classList.add('selected');
    }
    if (select.disabled) close();
  }
  toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); };
  picker.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { close(); toggle.focus(); } });
  document.addEventListener('click', event => { if (!picker.contains(event.target)) close(); });
  select.addEventListener('change', render);
  new MutationObserver(render).observe(select, {childList:true, subtree:true, attributes:true});
  render();
}
