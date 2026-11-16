// Detect long, approximately straight, high-contrast boundaries in a reduced frame.
// This deliberately favors large UI panels over small text and icons.
self.onmessage = ({data: {pixels, width: w, height: h}}) => {
  const gray = new Uint8Array(w * h), horizontal = [], vertical = [];
  for (let i = 0; i < gray.length; i++) gray[i] = (pixels[i * 4] * 77 + pixels[i * 4 + 1] * 150 + pixels[i * 4 + 2] * 29) >> 8;
  function lines(horizontalAxis) {
    const outer = horizontalAxis ? h : w, inner = horizontalAxis ? w : h, found = [];
    for (let a = 1; a < outer - 1; a++) {
      let start = -1, gaps = 0;
      for (let b = 1; b < inner; b++) {
        const i = horizontalAxis ? a * w + b : b * w + a;
        const delta = horizontalAxis ? w : 1;
        const edge = b < inner - 1 && Math.abs(gray[i - delta] - gray[i + delta]) >= 24;
        if (edge) { if (start < 0) start = b; gaps = 0; }
        else if (start >= 0 && ++gaps > 3) {
          const end = b - gaps;
          if (end - start >= Math.max(30, inner * .07)) found.push({a, start, end});
          start = -1; gaps = 0;
        }
      }
    }
    found.sort ( (a,b) => (b.end-b.start)-(a.end-a.start));
    // Adjacent edge pixels usually describe the same border.
    const merged = [];
    for (const line of found) {
      if (!merged.some(x => Math.abs(x.a-line.a)<=3 && Math.abs(x.start-line.start)<=5 && Math.abs(x.end-line.end)<=5)) merged.push(line);
      if (merged.length >= 120) break;
    }
    return merged;
  }
  horizontal.push(...lines(true)); vertical.push(...lines(false));
  const candidates = [];
  for (let i=0;i<horizontal.length;i++) for(let j=i+1;j<horizontal.length;j++) {
    const a=horizontal[i], b=horizontal[j], top=Math.min(a.a,b.a), bottom=Math.max(a.a,b.a);
    if (bottom-top < Math.max(25,h*.05)) continue;
    const left=Math.max(a.start,b.start), right=Math.min(a.end,b.end), rw=right-left;
    if (rw < Math.max(30,w*.07) || rw < .7*Math.max(a.end-a.start,b.end-b.start)) continue;
    const side = x => vertical.some(v => Math.abs(v.a-x)<=5 && v.start<=top+7 && v.end>=bottom-7);
    if (!side(left) || !side(right)) continue;
    candidates.push({x:left/w,y:top/h,w:rw/w,h:(bottom-top)/h});
  }
  candidates.sort((a,b)=>b.w*b.h-a.w*a.h);
  const rectangles=[];
  for (const r of candidates) {
    if (!rectangles.some(q=>Math.abs(q.x-r.x)<.015 && Math.abs(q.y-r.y)<.015 && Math.abs(q.w-r.w)<.03 && Math.abs(q.h-r.h)<.03)) rectangles.push(r);
    if(rectangles.length>=30) break;
  }
  self.postMessage(rectangles);
};
