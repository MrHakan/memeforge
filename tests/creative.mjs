import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099';
const browser = await chromium.launch(); let checks = 0;
const check = (name, value) => { assert.ok(value, name); console.log(`PASS  ${name}`); checks++; };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.stack));
  await page.route('**/*', async r => {
    const u = r.request().url(); if (u.startsWith(BASE) || /^(data|blob):/.test(u)) return r.continue();
    if (u.includes('api.imgflip.com')) return r.fulfill({ json: { success: true, data: { memes: [] } } });
    if (u.includes('api.memegen.link')) return r.fulfill({ json: [] }); return r.abort();
  });
  await page.goto(BASE); await page.waitForFunction(() => window.creative); await page.evaluate(()=>appReady);
  await page.evaluate(async () => {
    const { encodeGif } = await import('./js/media.js'), { fileToDataUrl } = await import('./js/util.js');
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; const ctx = c.getContext('2d');
    window.creativeFixture = await fileToDataUrl(await encodeGif({ width:64, height:48, count:5, frameAt:i=>{
      ctx.fillStyle = `hsl(${i*50},80%,45%)`; ctx.fillRect(0,0,64,48); ctx.fillStyle='#fff'; ctx.fillRect(10+i*5,15,12,12); return { canvas:c, delay:100 };
    }}));
    const bg = document.createElement('canvas'); bg.width = 320; bg.height = 240; const bc=bg.getContext('2d');
    const g=bc.createLinearGradient(0,0,320,240); g.addColorStop(0,'#ff0000'); g.addColorStop(1,'#0000ff'); bc.fillStyle=g; bc.fillRect(0,0,320,240); window.creativeStill=bg.toDataURL('image/png');
  });
  const fixtures=await page.evaluate(()=>[creativeFixture,creativeStill]);
  const waitForAutosave = async () => {
    for (let i=0;i<100;i++) {
      if(await page.evaluate(async()=>{const{getAutosave}=await import('./js/store.js');const a=await getAutosave();return !!a&&a.id===workbench.hooks.getProjectId()&&a.project.state===studio.toProject().state;})) return;
      await page.waitForTimeout(50);
    }
    throw new Error('Current editable state was not autosaved');
  };
  const loadGif = () => page.evaluate(async(src)=>{ studio.clearLayers(); studio.pad={top:0,right:0,bottom:0,left:0,color:'#ffffff',unit:'px'}; await loadMedia({src,kind:'gif',name:'Creative GIF',source:'upload'}); studio.seek(0); studio.setMode('video'); },fixtures[0]);
  const loadStill = () => page.evaluate(async(src)=>{ studio.clearLayers(); studio.pad={top:0,right:0,bottom:0,left:0,color:'#ffffff',unit:'px'}; await loadMedia({src,name:'Creative picture',source:'upload'}); },fixtures[1]);
  await loadGif();
  await page.evaluate(()=>{ studio.addShape('bar'); studio.update({left:10,top:10,scaleX:1,scaleY:1,angle:0,opacity:1}); });
  await page.locator('#poses-open').click(); await page.locator('#pose-capture-start').click();
  check('start pose records the canvas transform', await page.evaluate(()=>studio.selected().mfAnimation.start.left===10));
  await page.evaluate(()=>{studio.seek(4);studio.update({left:50,top:30,scaleX:2,scaleY:2,angle:90,opacity:0.5});});
  await page.locator('#poses-open').click(); await page.locator('#pose-capture-end').click();
  await page.evaluate(()=>studio.seek(2));
  check('pose interpolation animates position, scale, rotation and opacity', await page.evaluate(()=>{const o=studio.selected();return Math.abs(o.left-30)<1e-6&&Math.abs(o.top-20)<1e-6&&o.scaleX===1.5&&o.angle===45&&o.opacity===0.75;}));
  await page.evaluate(()=>studio.seek(4)); check('automatic pose duration reaches the final pose', await page.evaluate(()=>studio.selected().left===50));
  await page.locator('#poses-open').click(); await page.selectOption('#pose-easing','ease-in'); await page.locator('#editor-apply').click(); await page.evaluate(()=>studio.seek(2));
  check('pose easing changes intermediate movement', await page.evaluate(()=>studio.selected().left===20));
  const poseProject = await page.evaluate(()=>studio.toProject('Poses')); await page.evaluate(async p=>{await studio.fromProject(p);studio.seek(2);},poseProject);
  check('pose animation survives project reopening', await page.evaluate(()=>studio.canvas.getObjects()[0].left===20));
  await page.evaluate(()=>{studio.canvas.setActiveObject(studio.canvas.getObjects()[0]);studio.update({fill:'#00ff00'});studio.seek(4);});
  check('editing pose style keeps endpoint transforms unchanged', await page.evaluate(()=>studio.selected().left===50&&studio.selected().mfAnimation.end.scaleX===2));
  await page.evaluate(async()=>{await studio.duplicateSelected();studio.seek(4);});
  check('duplicated pose layers keep editable motion', await page.evaluate(()=>studio.selected().mfAnimation.kind==='poses'));

  await loadGif(); await page.evaluate(()=>{studio.setMode('frame');studio.seek(1);studio.addText('BOUND',{fontSize:10});studio.setMode('video');});
  await page.locator('#loop-open').click(); await page.locator('#loop-pingpong').check(); await page.fill('#loop-hold','200'); await page.locator('#editor-apply').click();
  check('ping-pong excludes duplicated endpoint frames and adds a final hold', await page.evaluate(()=>studio.media.frames.length===8&&studio.duration===1000&&studio.media.frames.at(-1).sourceIndex===1));
  check('frame-local bindings follow the return path', await page.evaluate(()=>studio.canvas.getObjects()[0].mfFrameIds.length===2));
  await page.evaluate(()=>studio.undo()); check('loop topology and duration are undoable', await page.evaluate(()=>studio.media.frames.length===5&&studio.duration===500));
  await page.locator('#loop-open').click(); await page.fill('#loop-transition','2'); await page.fill('#loop-delay','50'); await page.locator('#editor-apply').click();
  check('crossfade creates editable generated background frames', await page.evaluate(()=>studio.media.frames.length===7&&studio.duration===600&&studio.media.generatedFrames.length===2));
  check('crossfade blends source pixels', await page.evaluate(()=>{const f=studio.media.frames;const at=c=>[...c.getContext('2d').getImageData(1,1,1,1).data];return at(f[5].canvas).join()!==at(f[0].canvas).join()&&at(f[5].canvas).join()!==at(f[4].canvas).join();}));
  const loopProject = await page.evaluate(()=>studio.toProject('Crossfade')); await page.evaluate(async p=>{await studio.fromProject(p);studio.seek(5);},loopProject);
  check('generated frames restore from a portable project', await page.evaluate(()=>studio.media.frames.length===7&&studio.media.frames[5].canvas.width===64));
  const loopResult = await page.evaluate(async()=>{const {decodeGif}=await import('./js/media.js');const g=decodeGif(await(await studio.toGifBlob()).arrayBuffer());return[g.frames.length,g.frames.reduce((n,f)=>n+f.delay,0)];});
  check('export includes loop frames and exact total duration',loopResult[0]===7&&loopResult[1]===600);

  await loadStill();
  const originalPixels=await page.evaluate(()=>[...studio.mediaCtx.getImageData(0,0,320,240).data]);
  await page.locator('#mask-open').click(); await page.selectOption('#mask-kind','filter'); await page.fill('#mask-width','30'); await page.fill('#mask-saturate','0'); await page.locator('#editor-apply').click();
  let b=await page.locator('.upper-canvas').boundingBox();
  await page.mouse.move(b.x+b.width*0.25,b.y+b.height*0.4);await page.mouse.down();await page.mouse.move(b.x+b.width*0.7,b.y+b.height*0.4,{steps:10});await page.mouse.up();
  await page.locator('#drawing-stop').click();
  check('brush creates an editable irregular mask layer',await page.evaluate(()=>studio.canvas.getObjects()[0].mfMask===true&&studio.canvas.getObjects()[0].type==='path'));
  const maskResult=await page.evaluate(()=>({inside:[...studio.mediaCtx.getImageData(140,96,1,1).data],outside:[...studio.mediaCtx.getImageData(140,125,1,1).data]}));
  const oi=(125*320+140)*4;
  check('masked filter changes painted pixels',Math.abs(maskResult.inside[0]-maskResult.inside[2])<3);
  check('mask leaves unpainted pixels inside its bounding region untouched',maskResult.outside.join()===originalPixels.slice(oi,oi+4).join());
  const maskProject=await page.evaluate(()=>studio.toProject('Mask')); await page.evaluate(async p=>studio.fromProject(p),maskProject);
  check('brush mask and effect restore from project files',await page.evaluate(()=>studio.canvas.getObjects()[0].mfMask&&Math.abs(studio.mediaCtx.getImageData(140,96,1,1).data[0]-studio.mediaCtx.getImageData(140,96,1,1).data[2])<3));
  await page.evaluate(()=>{const o=studio.canvas.getObjects()[0];studio.canvas.setActiveObject(o);studio.update({top:o.top+50});});
  check('moving a mask moves its affected area',await page.evaluate(()=>{const p=studio.mediaCtx.getImageData(140,96,1,1).data;return Math.abs(p[0]-p[2])>10;}));
  await page.evaluate(()=>studio.undo());check('mask movement is undoable',await page.evaluate(()=>{const p=studio.mediaCtx.getImageData(140,96,1,1).data;return Math.abs(p[0]-p[2])<3;}));
  await page.evaluate(()=>studio.canvas.setActiveObject(studio.canvas.getObjects()[0]));
  await page.locator('#mask-open').click();await page.fill('#mask-width','12');await page.fill('#mask-saturate','100');await page.locator('#editor-apply').click();
  check('selected mask effect and brush width can be edited',await page.evaluate(()=>{const o=studio.selected(),p=studio.mediaCtx.getImageData(140,96,1,1).data;return o.mfRegion.saturate===100&&o.strokeWidth===12&&Math.abs(p[0]-p[2])>10;}));
  await page.evaluate(()=>studio.undo());check('mask effect changes are undoable',await page.evaluate(()=>studio.canvas.getObjects()[0].mfRegion.saturate===0&&studio.canvas.getObjects()[0].strokeWidth===30));
  await loadGif(); await page.locator('#mode-frame').click();await page.evaluate(()=>studio.seek(1));
  await page.locator('#mask-open').click();await page.locator('#editor-apply').click();b=await page.locator('.upper-canvas').boundingBox();
  await page.mouse.move(b.x+15,b.y+15);await page.mouse.down();await page.mouse.move(b.x+45,b.y+25,{steps:5});await page.mouse.up();await page.locator('#drawing-stop').click();
  check('GIF brush masks bind to selected frame IDs',await page.evaluate(()=>studio.canvas.getObjects()[0].mfFrameIds.length===1));await page.evaluate(()=>studio.seek(2));check('mask hides outside its GIF frame selection',await page.evaluate(()=>!studio.canvas.getObjects()[0].visible));

  await loadStill();await page.locator('#canvas-format').click();await page.selectOption('#canvas-ratio','9:16');await page.locator('#editor-apply').click();
  check('ratio presets set exact output dimensions',await page.evaluate(()=>studio.canvas.width===540&&studio.canvas.height===960));
  check('fit placement adds background space without distorting the image',await page.evaluate(()=>{const p=studio.imagePlacement;return p.width/p.height===4/3&&p.y>0&&studio.mediaCtx.getImageData(1,1,1,1).data[0]===255;}));
  await page.locator('#canvas-format').click();await page.selectOption('#canvas-mode','cover');await page.locator('#editor-apply').click();
  check('cover fills the format by cropping the source view',await page.evaluate(()=>studio.imagePlacement.x<0&&studio.imagePlacement.height===960));
  const sceneProject=await page.evaluate(()=>studio.toProject('Portrait'));await page.evaluate(async p=>studio.fromProject(p),sceneProject);
  check('format and placement persist in project files',await page.evaluate(()=>studio.scene.mode==='cover'&&studio.canvas.width===540));
  await page.locator('#canvas-format').click();await page.locator('#canvas-original').click();check('original canvas format can be restored',await page.evaluate(()=>studio.canvas.width===320&&studio.canvas.height===240));
  await page.evaluate(()=>studio.undo());check('canvas ratio changes are undoable',await page.evaluate(()=>studio.canvas.width===540));
  await loadStill();await page.evaluate(()=>studio.setPad({top:20,left:10}));await page.locator('#canvas-format').click();await page.selectOption('#canvas-ratio','1:1');await page.locator('#editor-apply').click();check('preset dimensions include existing padding',await page.evaluate(()=>studio.canvas.width===720&&studio.canvas.height===720));

  await loadStill();await page.evaluate(()=>{
    for(const [i,x]of[20,100,240].entries()){studio.addShape('rect');studio.update({left:x,top:25+i*40,width:20,height:20,originX:'left',originY:'top',strokeWidth:0,fill:['#ff0000','#00ff00','#0000ff'][i]});}
    studio.arrange(studio.canvas.getObjects(),'distribute-x');
  });
  check('distribution creates equal gaps between bounds',await page.evaluate(()=>{const a=studio.canvas.getObjects().map(o=>o.getBoundingRect());return Math.abs(a[1].left-a[0].left-a[0].width-(a[2].left-a[1].left-a[1].width))<1e-6;}));
  await page.locator('#arrange-open').click();for(const input of await page.locator('[data-object]').all())await input.check();await page.selectOption('#arrange-action','top');await page.locator('#editor-apply').click();
  check('multi-layer alignment works through the layer chooser',await page.evaluate(()=>studio.canvas.getObjects().every(o=>Math.abs(o.getBoundingRect().top-25)<1e-6)));
  await page.evaluate(()=>{const[o,t]=studio.canvas.getObjects();studio.canvas.setActiveObject(o);o.set({left:t.left-3,top:t.top+30});studio.snapObject(o);});
  check('snapping follows another layer’s edge',await page.evaluate(()=>studio.canvas.getObjects()[0].left===studio.canvas.getObjects()[1].left));
  check('smart guides are editor-only overlays',await page.locator('.creative-guides').isVisible());await page.evaluate(()=>studio.canvas.fire('mouse:up'));check('guides clear after moving a layer',!await page.locator('.creative-guides').isVisible());
  await loadGif();await page.evaluate(()=>{studio.addText('FIRST',{fontSize:10,left:15,top:12});studio.addShape('bar');studio.update({left:40,top:25});studio.setMode('frame');studio.seek(2);studio.canvas.setActiveObject(studio.canvas.getObjects()[0]);studio.update({text:'SECOND',left:25});});
  const groupBefore=await page.evaluate(()=>studio.canvas.getObjects().map(o=>o.getBoundingRect().toJSON?.()||o.getBoundingRect()));
  await page.evaluate(()=>studio.groupLayers(studio.canvas.getObjects().slice()));
  check('grouping creates an editable persistent group',await page.evaluate(()=>studio.canvas.getObjects().length===1&&studio.selected().type==='group'));
  check('grouping retains member frame-specific text',await page.evaluate(()=>studio.selected().getObjects()[0].text==='SECOND'));
  const groupAfter=await page.evaluate(()=>studio.selected().getObjects().map(o=>o.getBoundingRect()));check('grouping preserves member positions',groupAfter.every((r,i)=>Math.abs(r.left-groupBefore[i].left)<1e-5&&Math.abs(r.top-groupBefore[i].top)<1e-5));
  await page.evaluate(()=>studio.seek(0));check('group members still respond to GIF frame changes',await page.evaluate(()=>studio.canvas.getObjects()[0].getObjects()[0].text==='FIRST'));
  const gp=await page.evaluate(()=>studio.toProject('Group'));await page.evaluate(async p=>{await studio.fromProject(p);studio.seek(2);},gp);check('nested frame edits survive grouped project restoration',await page.evaluate(()=>studio.canvas.getObjects()[0].getObjects()[0].text==='SECOND'));
  await page.evaluate(()=>{studio.setMode('video');studio.canvas.setActiveObject(studio.canvas.getObjects()[0]);const g=studio.selected();studio.update({left:g.left+15,top:g.top+10,angle:20,scaleX:1.3,scaleY:1.3});});
  const transformed=await page.evaluate(()=>studio.canvas.getObjects()[0].getObjects().map(o=>o.getBoundingRect()));
  await page.evaluate(()=>studio.ungroupLayer());check('ungroup restores independently editable layers',await page.evaluate(()=>studio.canvas.getObjects().length===2));
  const ungrouped=await page.evaluate(()=>studio.canvas.getObjects().map(o=>o.getBoundingRect()));check('ungroup preserves transformed positions and sizes',ungrouped.every((r,i)=>['left','top','width','height'].every(k=>Math.abs(r[k]-transformed[i][k])<1e-5)));
  await page.evaluate(()=>studio.seek(0));check('ungroup preserves per-frame text',await page.evaluate(()=>studio.canvas.getObjects()[0].text==='FIRST'));await page.evaluate(()=>studio.seek(2));check('ungroup preserves later frame text',await page.evaluate(()=>studio.canvas.getObjects()[0].text==='SECOND'));
  await page.evaluate(()=>studio.undo());check('ungrouping is undoable',await page.evaluate(()=>studio.canvas.getObjects()[0].type==='group'));

  await loadStill();await page.evaluate(()=>{studio.addText('My mark',{fontSize:30,fill:'#ffee00',mfUpper:false});});
  await page.locator('#parts-open').click();await page.fill('#part-name','Watermark');await page.locator('#part-save').click();await page.waitForSelector('.part-card');
  check('personal parts are stored with transparent previews',await page.locator('.part-card img').count()===1);
  await page.evaluate(()=>studio.clearLayers());await page.locator('.part-card button',{hasText:'Add'}).first().click();await page.waitForFunction(()=>studio.canvas.getObjects().length===1);check('saved parts reinsert as editable layers',await page.evaluate(()=>studio.selected().text==='My mark'));
  await page.fill('#part-name','Yellow text');await page.locator('#part-style-save').click();await page.waitForFunction(()=>document.querySelectorAll('.part-card').length===2);
  await page.evaluate(()=>{studio.addText('TARGET');studio.update({fill:'#ff0000'});});await page.locator('.part-card',{hasText:'Yellow text'}).locator('button',{hasText:'Add'}).click();await page.waitForFunction(()=>studio.selected()?.fill==='#ffee00');check('saved style applies to the selected text without changing its content',await page.evaluate(()=>studio.selected().fill==='#ffee00'&&studio.selected().text==='TARGET'));
  await page.locator('#parts-close').click();await waitForAutosave();await page.reload();await page.evaluate(()=>appReady);await page.waitForFunction(()=>studio.hasMedia);await page.locator('#parts-open').click();await page.waitForFunction(()=>document.querySelectorAll('.part-card').length===2);check('parts library persists after reload',true);
  await page.evaluate(()=>studio.clearLayers());await page.locator('.part-card',{hasText:'Watermark'}).dragTo(page.locator('.upper-canvas'));await page.waitForFunction(()=>studio.canvas.getObjects().length===1);check('parts can be dragged onto the canvas',await page.evaluate(()=>studio.selected().text==='My mark'));
  await page.locator('#parts-close').click();

  await page.locator('#versions-open').click();await page.fill('#version-name','First draft');await page.locator('#version-save').click();await page.waitForSelector('.version-card');
  await page.locator('#editor-apply').click();await page.evaluate(()=>{studio.canvas.setActiveObject(studio.canvas.getObjects()[0]);studio.update({text:'ALTERNATE'});});
  await page.locator('#versions-open').click();await page.fill('#version-name','Alternate');await page.locator('#version-save').click();await page.waitForFunction(()=>document.querySelectorAll('.version-card').length===2);
  const v=await page.locator('.version-card').evaluateAll(ns=>ns.map(n=>({id:n.dataset.version,name:n.querySelector('strong').textContent})));
  await page.selectOption('#version-left',v.find(x=>x.name==='First draft').id);await page.selectOption('#version-right',v.find(x=>x.name==='Alternate').id);await page.locator('#versions-compare').click();await page.waitForSelector('#version-compare img');
  check('two named versions compare side by side',await page.locator('#version-compare img').count()===2);
  await page.locator('.version-card',{hasText:'First draft'}).locator('button',{hasText:'Restore'}).click();await page.waitForFunction(()=>!document.querySelector('#editor-dialog').open&&studio.canvas.getObjects()[0].text==='My mark');check('checkpoint restores editable project state',true);
  await page.locator('#versions-open').click();await page.waitForFunction(()=>document.querySelector('#editor-dialog').open&&document.querySelector('.version-list').textContent.includes('Before restoring'));check('current work is preserved before restoring a checkpoint',/Before restoring/.test(await page.locator('.version-list').textContent()));await page.locator('#editor-apply').click();
  await waitForAutosave();await page.reload();await page.evaluate(()=>appReady);await page.waitForFunction(()=>studio.hasMedia);await page.locator('#versions-open').click();await page.waitForFunction(()=>document.querySelectorAll('.version-card').length===3);check('checkpoints remain attached to the project after reload',true);check('checkpoint layers restore completely after reload',await page.evaluate(()=>studio.canvas.getObjects()[0]?.text==='My mark'));
  await page.locator('#editor-apply').click();await page.setViewportSize({width:390,height:844});await page.locator('#parts-open').click();check('parts shelf fits mobile viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#parts-close').click();await page.locator('#canvas-format').click();check('canvas format form fits mobile viewport',await page.evaluate(()=>document.querySelector('#editor-dialog').scrollWidth<=document.querySelector('#editor-dialog').clientWidth+1));await page.locator('#editor-cancel').click();
  await page.screenshot({path:'tests/shots/14-creative-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#versions-open').click();await page.waitForFunction(()=>document.querySelector('#editor-dialog').open);
  await page.locator('#versions-compare').click();await page.waitForSelector('#version-compare img');
  await page.screenshot({path:'tests/shots/15-version-compare.png',fullPage:true});await page.locator('#editor-apply').click();
  await loadGif();
  await page.evaluate(()=>{studio.setScene({width:120,height:200,mode:'fit',color:'#112233'},false);studio.addShape('bar');studio.update({fill:'#ffff00'});});
  const formatGif=await page.evaluate(async()=>{const{decodeGif}=await import('./js/media.js');const g=decodeGif(await(await studio.toGifBlob()).arrayBuffer());return{width:g.width,height:g.height,count:g.frames.length,pixel:[...g.frames[0].canvas.getContext('2d').getImageData(1,1,1,1).data]};});
  check('GIF exports honor the canvas format and background color',formatGif.width===120&&formatGif.height===200&&formatGif.count===5&&Math.abs(formatGif.pixel[0]-17)<10);
  await page.evaluate(()=>{studio.setScene(null);studio.clearLayers();studio.setMode('frame');studio.seek(1);studio.addText('LOCAL',{fontSize:10});studio.setMode('video');studio.addShape('bar');studio.groupLayers(studio.canvas.getObjects());});
  await page.evaluate(async src=>{await loadMedia({src,kind:'gif',name:'Replacement',source:'upload'});studio.seek(2);},fixtures[0]);
  check('replacing GIF media resets stale frame bindings inside groups',await page.evaluate(()=>studio.canvas.getObjects()[0].getObjects().every(o=>!o.mfFrameIds&&o.visible)));
  await page.evaluate(()=>{studio.ungroupLayer(studio.canvas.getObjects()[0]);studio.setMaskDrawing({kind:'pixelate',strength:8},20);});
  b=await page.locator('.upper-canvas').boundingBox();await page.mouse.move(b.x+10,b.y+10);await page.mouse.down();await page.mouse.move(b.x+45,b.y+25,{steps:5});await page.mouse.up();
  await page.evaluate(()=>studio.setDrawing('none'));
  const strokes=await page.evaluate(()=>studio.canvas.getObjects().length);await page.evaluate(()=>studio.undo());
  check('one undo removes a complete mask stroke without leaving purple artwork',await page.evaluate(n=>studio.canvas.getObjects().length===n-1,strokes));
  await page.evaluate(()=>{studio.canvas.setActiveObject(studio.canvas.getObjects()[0]);studio.setMode('video');studio.update({text:'ZERO',shadow:'rgba(0,0,0,0.5) 2px 2px 4px'});});
  await page.locator('#parts-open').click();await page.fill('#part-name','Shadow style');await page.locator('#part-style-save').click();await page.waitForFunction(()=>document.querySelector('#part-list').textContent.includes('Shadow style'));
  await page.evaluate(()=>studio.update({shadow:null}));await page.locator('.part-card',{hasText:'Shadow style'}).locator('button',{hasText:'Add'}).click();await page.waitForFunction(()=>!!studio.selected()?.shadow);
  check('saved text styles retain editable shadows',await page.evaluate(()=>studio.selected().shadow.blur===4));await page.locator('#parts-close').click();

  if(errors.length)console.log(errors);check('creative workflows have no uncaught exceptions',errors.length===0);
  console.log(`\n${checks}/${checks} creative checks passed`);
} finally { await browser.close(); }
