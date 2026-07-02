async function generateDD(){
  if(!gData)return;
  const btn=document.getElementById('dd-gen-btn');
  if(btn)btn.disabled=true;
  switchTab('dd');showDDLoad();
  const metricList=[];
  (gData.stages||[]).forEach(st=>{
    (st.l1_metrics||[]).forEach(l1=>{
      if(!l1||!l1.name)return;
      metricList.push({stage:st.label,level:'L1',name:l1.name});
      (l1.l2_metrics||[]).forEach(l2=>{
        if(!l2||!l2.name)return;
        metricList.push({stage:st.label,level:'L2',name:l2.name});
        (l2.l3_metrics||[]).forEach(l3=>{
          if(!l3||!l3.name)return;
          metricList.push({stage:st.label,level:'L3',name:l3.name});
        });
      });
    });
  });
  try{
    const txt=await callAPI((typeof SYS_DD!=='undefined'?SYS_DD:''),buildDDPrompt(metricList),8000,null,'claude-haiku-4-5','md-dd-batch');
    const clean=txt.replace(/```json|```/g,'').trim();
    let metrics=null;
    try{const arr=JSON.parse(clean);if(Array.isArray(arr))metrics=arr;else if(arr&&arr.metrics)metrics=arr.metrics;}
    catch(e){const m=clean.match(/\[[\s\S]*/);if(m){const s=m[0];const last=s.lastIndexOf('}');if(last>0){try{metrics=JSON.parse(s.substring(0,last+1)+']');}catch(e2){}}}}
    if(!metrics||!metrics.length)throw new Error('Could not parse definitions. Raw: '+clean.substring(0,200));
    hideDDLoad();ddGenerated=true;renderDDTable(metrics);
    document.getElementById('dd-out').classList.add('on');
  }catch(err){
    hideDDLoad();if(btn)btn.disabled=false;
    document.getElementById('er').classList.add('on');
    document.getElementById('er-msg').textContent='Error: '+err.message;
  }
}


function renderDDEmpty(){
  document.getElementById('dd-out').innerHTML=`<div class="dd-empty">
    <div class="dd-empty-icon">&#128203;</div>
    <div class="dd-empty-title">Metrics Document</div>
    <div class="dd-empty-desc">KPI tree is ready. Generate the full metrics dictionary — definitions, benchmarks, and red flags for every L1 and L2 metric.</div>
    <button class="dd-gen-btn" id="dd-gen-btn" onclick="generateDD()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Generate Metrics Document
    </button>
    <div style="font-size:10px;color:var(--t4);margin-top:-4px;">Separate AI call — ~15 seconds</div>
  </div>`;
}

function renderDDTable(metrics){
  const c=document.getElementById('dd-out');
  if(!gData)return;
  const defMap={};
  metrics.forEach(function(m){defMap[m.name.toLowerCase().trim()]=m;});
  const rows=[];
  (gData.stages||[]).forEach(function(st){
    (st.l1_metrics||[]).forEach(function(l1){
      if(!l1||!l1.name)return;
      const d=defMap[l1.name.toLowerCase().trim()]||{};
      rows.push({stage:st.id,sl:st.label,lvl:'L1',name:l1.name,why:l1.why||'',def:d.definition||'—',bm:d.benchmark||'—',rf:d.red_flag||'—'});
      (l1.l2_metrics||[]).forEach(function(l2){
        if(!l2||!l2.name)return;
        const d2=defMap[l2.name.toLowerCase().trim()]||{};
        rows.push({stage:st.id,sl:st.label,lvl:'L2',name:l2.name,why:l2.why||'',def:d2.definition||'—',bm:d2.benchmark||'—',rf:d2.red_flag||'—'});
        (l2.l3_metrics||[]).forEach(function(l3){
          if(!l3||!l3.name)return;
          const d3=defMap[l3.name.toLowerCase().trim()]||{};
          rows.push({stage:st.id,sl:st.label,lvl:'L3',name:l3.name,why:l3.why||'',def:d3.definition||'—',bm:d3.benchmark||'—',rf:d3.red_flag||'—'});
          if(l3.l4_metrics)l3.l4_metrics.forEach(function(l4){if(l4)rows.push({stage:st.id,sl:st.label,lvl:'L4',name:l4,why:'',def:'—',bm:'—',rf:'—'});});
        });
      });
    });
  });
  window._ddRows=rows;

  // Build stage colour map
  const ddColorMap={};
  if(typeof STAGE_PALETTE!=='undefined'){
    (gData.stages||[]).forEach(function(st,i){ddColorMap[st.id]=STAGE_PALETTE[i%STAGE_PALETTE.length];});
  }

  // Build filter chips
  let chips='';
  (gData.stages||[]).forEach(function(st){
    chips+='<button class="fchip" data-stageid="'+e(st.id)+'" onclick="filtStage(this)">'+e(st.label)+'</button>';
  });

  const productName=(productContext&&productContext.name)||(gData&&gData.productName)||'';
  const totalMetrics=rows.length;
  const totalStages=(gData.stages||[]).length;
  const l1count=rows.filter(r=>r.lvl==='L1').length;

  // Single toolbar row: title+meta left, download right
  let h='<div class="dd-toolbar">';
  h+='<div class="dd-toolbar-left">';
  h+=`<div class="dd-context-title">${productName?e(productName)+' — ':''}Metrics Dictionary</div>`;
  h+=`<div class="dd-context-meta">${totalStages} stage${totalStages!==1?'s':''} · ${l1count} L1 metrics · ${totalMetrics} total metrics defined</div>`;
  h+='</div>';
  h+='<button class="dl-btn" onclick="downloadXLSX()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download</button>';
  h+='</div>';

  // Filter row
  h+='<div class="dflt"><span class="dflt-lbl">Filter:</span>';
  h+='<button class="fchip on" data-stageid="all" onclick="filtStage(this)">All</button>';
  h+=chips;
  h+='<button class="fchip" data-stageid="L1" onclick="filtStage(this)">L1 only</button>';
  h+='<button class="fchip" data-stageid="L2" onclick="filtStage(this)">L2 only</button>';
  h+='</div>';

  // Table inside its own scroll wrapper so thead sticky works correctly
  h+='<div class="dt-scroll-wrap"><table class="dt" id="dtt"><thead><tr><th>Stage</th><th>Level</th><th>Metric</th><th>Why it matters</th><th>Definition</th><th>Benchmark</th><th>Red Flag</th></tr></thead><tbody>';
  rows.forEach(function(r){
    const stClr=ddColorMap[r.stage]||'#185FA5';
    const bgCls=r.lvl==='L3'?' class="dt-l3"':r.lvl==='L4'?' class="dt-l4"':'';
    h+='<tr data-stage="'+r.stage+'" data-lvl="'+r.lvl+'"'+bgCls+'>';
    // Stage cell: truncated badge with title tooltip
    h+='<td><span class="spill" style="background:'+stClr+';color:#fff;" title="'+e(r.sl)+'">'+e(r.sl)+'</span></td>';
    h+='<td><span class="lvlbdg">'+r.lvl+'</span></td>';
    h+='<td class="mn-cell">'+e(r.name)+'</td>';
    h+='<td class="why-cell">'+(r.why?e(r.why):'—')+'</td>';
    h+='<td class="def-cell">'+e(r.def)+'</td>';
    h+='<td class="bm-cell">'+e(r.bm)+'</td>';
    h+='<td class="rf-cell">'+e(r.rf)+'</td>';
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  c.innerHTML=h;
}

function filtStage(btn){
  document.querySelectorAll('.fchip').forEach(function(b){b.classList.remove('on');});
  btn.classList.add('on');
  const val=btn.dataset.stageid||'all';
  document.querySelectorAll('#dtt tbody tr').forEach(function(r){
    if(val==='all'){r.style.display='';return;}
    r.style.display=(r.dataset.stage===val||r.dataset.lvl===val)?'':'none';
  });
}
