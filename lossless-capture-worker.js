let folder, canvas, ctx;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try { folder=data.folder; canvas=new OffscreenCanvas(1,1);ctx=canvas.getContext('2d',{alpha:false}); if(!ctx)throw new Error('Could not create a worker canvas'); self.postMessage({type:'ready'}); }
    catch(error){self.postMessage({type:'error',message:error.message});}
    return;
  }
  if (data.type !== 'frame') return;
  const frame=data.frame;
  try {
    const region=data.region||{x:0,y:0,w:frame.displayWidth,h:frame.displayHeight};if(canvas.width!==region.w||canvas.height!==region.h){canvas.width=region.w;canvas.height=region.h}
    const drawStarted=performance.now();ctx.drawImage(frame,region.x,region.y,region.w,region.h,0,0,canvas.width,canvas.height);const drawFinished=performance.now();
    const png=await canvas.convertToBlob({type:'image/png'}),encodeFinished=performance.now();
    const handle=await folder.getFileHandle(data.name,{create:true}),writer=await handle.createWritable();
    try{await writer.write(png);await writer.close()}catch(error){try{await writer.abort()}catch{}throw error}
    const writeFinished=performance.now();
    self.postMessage({type:'saved',width:canvas.width,height:canvas.height,bytes:png.size,drawMs:drawFinished-drawStarted,encodeMs:encodeFinished-drawFinished,writeMs:writeFinished-encodeFinished});
  }catch(error){self.postMessage({type:'error',message:error.message});}
  finally{frame.close()}
};
