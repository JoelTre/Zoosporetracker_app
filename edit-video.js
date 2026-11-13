let editListVersion = 0, editLoadVersion = 0, editUrl = null, editInfo = null;
async function refreshEditFiles() {
  const version = ++editListVersion, folder = dir, select = $('#editFile'), previous = select.value;
  select.replaceChildren(new Option(folder ? 'Loading videos…' : 'Connect a folder to see videos', ''));
  select.disabled = true;
  if (editInfo && editInfo.folder !== folder) resetEditor();
  if (!folder) { resetEditor(); return; }
  try {
    const entries = [];
    for await (const entry of folder.values()) if (entry.kind === 'file' && /\.(webm|mp4|mov|mkv|ogv)$/i.test(entry.name)) entries.push(entry);
    const videos = await Promise.all(entries.map(async entry => ({name: entry.name, modified: (await entry.getFile()).lastModified})));
    if (version !== editListVersion || folder !== dir) return;
    videos.sort((a,b) => b.modified-a.modified || a.name.localeCompare(b.name));
    select.replaceChildren(new Option(videos.length ? 'Select a video' : 'No videos in this folder', ''));
    for (const video of videos) select.add(new Option(video.name, video.name));
    if (videos.some(video => video.name === previous)) select.value = previous;
    else resetEditor();
    select.disabled = !videos.length;
  } catch (error) {
    if (version !== editListVersion) return;
    resetEditor(); select.replaceChildren(new Option('Could not read folder', ''));
    $('#editStatus').textContent = 'Could not read the folder: ' + error.message;
  }
}
function resetEditor() {
  editLoadVersion++; editInfo = null; $('#editControls').hidden = true;
  const video = $('#editPreview'); video.pause(); video.removeAttribute('src'); video.load();
  if (editUrl) URL.revokeObjectURL(editUrl); editUrl = null;
  $('#editStatus').textContent = 'Select a video to get started.';
}
$('#refreshEditFiles').onclick = refreshEditFiles;
$('#editFile').onchange = async () => {
  resetEditor(); const name = $('#editFile').value, folder = dir, version = editLoadVersion;
  if (!name || !folder) return;
  $('#editStatus').textContent = 'Loading video…'; let input;
  try {
    const file = await (await folder.getFileHandle(name)).getFile();
    const m = await import('./mediabunny.mjs');
    input = new m.Input({formats: m.ALL_FORMATS, source: new m.BlobSource(file)});
    const track = await input.getPrimaryVideoTrack();
    if (!track || !await track.canDecode()) throw new Error('This browser cannot decode the video.');
    const duration = await input.computeDuration(), sink = new m.CanvasSink(track, {poolSize:1});
    const frame = await sink.getCanvas(await track.getFirstTimestamp());
    if (!frame || !Number.isFinite(duration) || duration <= 0) throw new Error('Could not read video dimensions or duration.');
    if (version !== editLoadVersion || folder !== dir) return;
    const width = frame.canvas.width, height = frame.canvas.height;
    editInfo = {file, folder, name, width, height, duration};
    $('#editLeft').value = $('#editTop').value = 0; $('#editWidth').value = width; $('#editHeight').value = height;
    $('#editStart').value = 0; $('#editEnd').value = duration;
    $('#editStage').style.setProperty('--edit-aspect', width / height);
    $('#editPreview').style.aspectRatio = width + ' / ' + height;
    $('#editTrimStart').max = $('#editTrimEnd').max = duration;
    updateCropBox(); updateTrimBar();
    $('#editDimensions').textContent = `${width} × ${height} pixels · ${duration.toFixed(2)} seconds`;
    editUrl = URL.createObjectURL(file); $('#editPreview').src = editUrl;
    $('#editControls').hidden = false; $('#editStatus').textContent = 'Adjust the crop or trim settings, then save.';
  } catch (error) { if (version === editLoadVersion) $('#editStatus').textContent = 'Could not load video: ' + error.message; }
  finally { input?.dispose(); }
};
$('#saveEdit').onclick = async () => {
  const info = editInfo; if (!info) return;
  const left = Number($('#editLeft').value), top = Number($('#editTop').value), width = Number($('#editWidth').value), height = Number($('#editHeight').value);
  const start = Number($('#editStart').value), end = Number($('#editEnd').value), status = $('#editStatus');
  if (![$('#editLeft'),$('#editTop'),$('#editWidth'),$('#editHeight'),$('#editStart'),$('#editEnd')].every(el => el.value !== '') || ![left,top,width,height].every(Number.isInteger) || left < 0 || top < 0 || width < 1 || height < 1 || left + width > info.width || top + height > info.height) { status.textContent = 'Enter a crop rectangle within the video dimensions.'; return; }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > info.duration || start >= end) { status.textContent = 'Enter valid start and end times within the video duration.'; return; }
  const cropped = left !== 0 || top !== 0 || width !== info.width || height !== info.height;
  const trimmed = start > 0 || end < info.duration;
  if (!cropped && !trimmed) { status.textContent = 'Change the crop or trim settings before saving.'; return; }
  const suffix = cropped && trimmed ? 'Cropped_and_trimmed' : cropped ? 'Cropped' : 'Trimmed';
  const desired = info.name.replace(/\.[^.]+$/, '') + '_' + suffix + '.webm';
  const controls = [$('#editFile'), $('#refreshEditFiles'), $('#saveEdit'), $('#connect'), ...$('#editControls').querySelectorAll('input, select, button')];
  controls.forEach(el => el.disabled = true); let input, output;
  try {
    status.textContent = 'Preparing edited video…';
    const m = await import('./mediabunny.mjs');
    input = new m.Input({formats:m.ALL_FORMATS, source:new m.BlobSource(info.file)});
    const target = new m.BufferTarget(); output = new m.Output({format:new m.WebMOutputFormat(), target});
    const conversion = await m.Conversion.init({input, output, trim:{start, end}, video: cropped ? {crop:{left,top,width,height}} : {}});
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error('The browser cannot preserve all video and audio tracks in the edited WebM file.');
    conversion.onProgress = progress => { status.textContent = `Editing video: ${Math.round(progress * 100)}%…`; };
    await conversion.execute();
    const name = await uniqueName(info.folder, desired), handle = await info.folder.getFileHandle(name, {create:true});
    const writer = await handle.createWritable();
    try { await writer.write(new Blob([target.buffer], {type:'video/webm'})); await writer.close(); }
    catch (error) { try { await writer.abort(); } catch {} try { await info.folder.removeEntry(name); } catch {} throw error; }
    await refreshEditFiles();
    status.textContent = `Saved “${name}”. The original was kept.`;
  } catch (error) { if (output?.state === 'started') try { await output.cancel(); } catch {} status.textContent = 'Could not edit video: ' + error.message; }
  finally { input?.dispose(); controls.forEach(el => el.disabled = false); $('#editFile').disabled = !$('#editFile').options.length || ($('#editFile').options.length === 1 && !$('#editFile').value); }
};

// Keep the visual crop and the pixel fields in the same source coordinate space.
function updateCropBox() {
  if (!editInfo) return;
  const values = ['editLeft','editTop','editWidth','editHeight'].map(id => Number($('#'+id).value));
  const [left, top, width, height] = values;
  if (values.some(v => !Number.isFinite(v)) || left < 0 || top < 0 || width < 1 || height < 1 || left + width > editInfo.width || top + height > editInfo.height) return;
  Object.assign($('#editCropBox').style, {left: left/editInfo.width*100+'%', top: top/editInfo.height*100+'%', width: width/editInfo.width*100+'%', height: height/editInfo.height*100+'%'});
}
for (const id of ['editLeft','editTop','editWidth','editHeight']) $('#'+id).addEventListener('input', updateCropBox);
function moveCropEdge(edge, value) {
  if (!editInfo) return;
  let left=Number($('#editLeft').value), top=Number($('#editTop').value), right=left+Number($('#editWidth').value), bottom=top+Number($('#editHeight').value);
  if (![left,top,right,bottom].every(Number.isFinite) || left<0 || top<0 || right>editInfo.width || bottom>editInfo.height || right<=left || bottom<=top) return;
  value=Math.round(value);
  if (edge==='left') left=Math.max(0,Math.min(right-1,value));
  if (edge==='right') right=Math.max(left+1,Math.min(editInfo.width,value));
  if (edge==='top') top=Math.max(0,Math.min(bottom-1,value));
  if (edge==='bottom') bottom=Math.max(top+1,Math.min(editInfo.height,value));
  $('#editLeft').value=left; $('#editTop').value=top; $('#editWidth').value=right-left; $('#editHeight').value=bottom-top;
  updateCropBox();
}
for (const handle of $$('#editCropBox button')) {
  handle.addEventListener('pointerdown', e => { if (!editInfo || e.button !== 0) return; e.preventDefault(); handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', e => {
    if (!handle.hasPointerCapture(e.pointerId) || !editInfo) return;
    const rect=$('#editStage').getBoundingClientRect(), edge=handle.dataset.edge;
    moveCropEdge(edge, edge==='left'||edge==='right' ? (e.clientX-rect.left)*editInfo.width/rect.width : (e.clientY-rect.top)*editInfo.height/rect.height);
  });
  handle.addEventListener('keydown', e => {
    const edge=handle.dataset.edge, horizontal=edge==='left'||edge==='right';
    const direction=horizontal ? (e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0) : (e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0);
    if (!direction) return; e.preventDefault();
    const current=edge==='left'?Number($('#editLeft').value):edge==='right'?Number($('#editLeft').value)+Number($('#editWidth').value):edge==='top'?Number($('#editTop').value):Number($('#editTop').value)+Number($('#editHeight').value);
    moveCropEdge(edge,current+direction*(e.shiftKey?10:1));
  });
}
function updateTrimBar() {
  if (!editInfo) return;
  const start=Number($('#editStart').value), end=Number($('#editEnd').value), duration=editInfo.duration;
  if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration||start>=end) return;
  $('#editTrimStart').value=start; $('#editTrimEnd').value=end;
  Object.assign($('#editTrimSelected').style,{left:start/duration*100+'%',width:(end-start)/duration*100+'%'});
}
for (const id of ['editStart','editEnd']) $('#'+id).addEventListener('input', updateTrimBar);
for (const [slider,field,other,isStart] of [['editTrimStart','editStart','editEnd',true],['editTrimEnd','editEnd','editStart',false]]) {
  $('#'+slider).addEventListener('input', e => {
    if (!editInfo) return;
    const gap=Math.min(0.001,editInfo.duration/1000), boundary=Number($('#'+other).value);
    const value=isStart?Math.max(0,Math.min(Number(e.target.value),boundary-gap)):Math.min(editInfo.duration,Math.max(Number(e.target.value),boundary+gap));
    $('#'+field).value=value; updateTrimBar();
    const video=$('#editPreview'); if (Number.isFinite(value)) { try { video.currentTime=value; } catch {} }
  });
}
