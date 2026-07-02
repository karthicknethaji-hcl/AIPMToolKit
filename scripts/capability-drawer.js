// CAPABILITY DRAWER
let capMetric=null,capStage=null,capLoading=false;
const CAP_MSGS=["Researching capabilities...","Scanning what moves this metric...","Finding features that work...","Asking what top PMs build next..."];

let capActiveLid=null;
function openCapDrawerFromBtn(btn){
  // Clear previous active
  if(capActiveLid){
    const prev=document.getElementById(capActiveLid);
    if(prev)prev.classList.remove('cap-active');
    capActiveLid=null;
  }
  // Find closest metric card (l1, l2, or l3)
  const card=btn.closest('.l1,.l2,.l3');
  if(card){capActiveLid=card.id;card.classList.add('cap-active');}
  openCapDrawer(btn.dataset.metric, btn.dataset.stage);
}
function openCapDrawer(metricName,stageName){
  capMetric=metricName;capStage=stageName;
  document.getElementById('cap-metric-name').textContent=metricName;
  document.getElementById('cap-stage-name').textContent=stageName+' Stage Metric';
  document.getElementById('cap-content').innerHTML='';
  document.getElementById('cap-refine-txt').value='';
  document.getElementById('cap-drawer').classList.add('open');
  document.getElementById('cap-overlay').classList.add('on');
  // Check capStore first — if capabilities already generated in Canvas, use them
  const stageId=stageName.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  const metricKey=stageId+'||'+metricName;
  const stored=capStore&&capStore[metricKey];
  if(stored&&stored.capabilities&&stored.capabilities.length){
    renderCapabilities({capabilities:stored.capabilities.map(cap=>({
      name:cap.name,why:cap.why,
      features:cap.featStore&&cap.featStore.top?cap.featStore.top:[]
    }))});
  } else {
    loadCapabilities('');
  }
}
function closeCapDrawer(){
  document.getElementById('cap-drawer').classList.remove('open');
  document.getElementById('cap-overlay').classList.remove('on');
  if(capActiveLid){
    const el=document.getElementById(capActiveLid);
    if(el)el.classList.remove('cap-active');
    capActiveLid=null;
  }
}
function refineCapabilities(){loadCapabilities(document.getElementById('cap-refine-txt').value.trim());}

let capReqId=0;
async function loadCapabilities(refinement){
  if(!capMetric)return;
  capLoading=true;
  const thisReqId=++capReqId;
  const loading=document.getElementById('cap-loading');
  const capContent=document.getElementById('cap-content');
  loading.classList.add('on');capContent.innerHTML='';
  document.getElementById('cap-refine-btn').disabled=true;
  const capSteps=["Analysing what moves this metric...","Scanning product patterns in this category...","Identifying capabilities that have worked...","Mapping features to specific outcomes..."];
  const capSubs=["Drawing on patterns from leading products.","Cross-referencing with your product context.","Almost there..."];
  let mi=0;
  document.getElementById('cap-load-txt').textContent=capSteps[0];
  document.getElementById('cap-load-sub').textContent=capSubs[0];
  const sc=document.getElementById('cap-load-steps');
  sc.innerHTML=capSteps.map((s,i)=>`<div class="cap-ls" id="capls${i}"><div class="cap-ls-dot"></div>${s}</div>`).join('');
  document.getElementById('capls0').classList.add('act');
  let si=0;
  const stepT=setInterval(()=>{if(si<capSteps.length-1){document.getElementById('capls'+si).classList.remove('act');document.getElementById('capls'+si).classList.add('done');si++;document.getElementById('capls'+si).classList.add('act');}},2800);
  const msgT=setInterval(()=>{mi=(mi+1)%capSubs.length;document.getElementById('cap-load-sub').textContent=capSubs[mi];},3500);
  const productName=document.getElementById('f-name').value.trim();
  const nsm=gData?gData.nsm.metric:'';
  try{
    const txt=await callAPI(
      'You are a senior product strategist. You know what features actually move metrics. Be specific and actionable. Respond ONLY with valid JSON. No markdown, no backticks, no preamble.',
      buildCapPrompt(productName,nsm,capMetric,capStage,refinement),
      3000,
      undefined,
      undefined,
      'drawer-gen-features'
    );
    let parsed;
    const cleanTxt=txt.replace(/```json|```/g,'').trim();
    try{parsed=JSON.parse(cleanTxt);}
    catch(pe){
      // Attempt repair: balance braces/brackets from the start
      const start=cleanTxt.indexOf('{');
      if(start>=0){
        let b=0,br=0,end=start;
        for(let ci=start;ci<cleanTxt.length;ci++){
          if(cleanTxt[ci]==='{')b++;else if(cleanTxt[ci]==='}')b--;
          if(cleanTxt[ci]==='[')br++;else if(cleanTxt[ci]===']')br--;
          end=ci;
          if(b===0&&br===0&&ci>start)break;
        }
        let fragment=cleanTxt.substring(start,end+1);
        let close='';
        // Recount unclosed after fragment
        let ob2=0,ob3=0;
        for(let ci=0;ci<fragment.length;ci++){if(fragment[ci]==='{')ob2++;else if(fragment[ci]==='}')ob2--;if(fragment[ci]==='[')ob3++;else if(fragment[ci]===']')ob3--;}
        for(let i=0;i<ob3;i++)close+=']';for(let i=0;i<ob2;i++)close+='}';
        try{parsed=JSON.parse(fragment+close);}
        catch(pe2){
          // Last resort: extract whatever capabilities array we can
          const capStart=cleanTxt.indexOf('"capabilities"');
          if(capStart>=0){
            const arrStart=cleanTxt.indexOf('[',capStart);
            if(arrStart>=0){
              // Find all complete capability objects
              const caps=[];
              let depth=0,objStart=-1;
              for(let ci=arrStart;ci<cleanTxt.length;ci++){
                if(cleanTxt[ci]==='{'){if(depth===0)objStart=ci;depth++;}
                else if(cleanTxt[ci]==='}'){depth--;if(depth===0&&objStart>=0){try{caps.push(JSON.parse(cleanTxt.substring(objStart,ci+1)));}catch(e){}objStart=-1;}}
              }
              if(caps.length>0){parsed={capabilities:caps};}
              else throw new Error('Response could not be parsed. Try again.');
            } else throw new Error('Response could not be parsed. Try again.');
          } else throw new Error('Response could not be parsed. Try again.');
        }
      } else throw new Error('Response could not be parsed. Try again.');
    }
    clearInterval(msgT);clearInterval(stepT);loading.classList.remove('on');
    if(thisReqId===capReqId)renderCapabilities(parsed);
  }catch(err){
    clearInterval(msgT);clearInterval(stepT);loading.classList.remove('on');
    if(thisReqId===capReqId){
      capContent.innerHTML='<div class="cap-error-inline"><div class="cap-error-inline-top"><i class="ti ti-alert-circle cap-error-inline-icon" aria-hidden="true"></i><div class="cap-error-inline-msg"><strong>Couldn\'t generate capabilities</strong><span>'+e(err.message)+'. This is usually temporary — wait a moment and retry.</span></div></div><div class="cap-error-inline-actions"><button class="cap-error-inline-retry" onclick="loadCapabilities(\'\')"><i class="ti ti-refresh" style="font-size:11px;" aria-hidden="true"></i> Try again</button><button class="cap-error-inline-dismiss" onclick="closeCapDrawer()">Dismiss</button></div></div>';
    }
  }finally{clearInterval(msgT);clearInterval(stepT);document.getElementById('cap-refine-btn').disabled=false;capLoading=false;}
}

function buildCapPrompt(product,nsm,metric,stage,refinement){
  const industry=productContext?productContext.industry:(seg?seg.industry:'');
  const frameworks=productContext&&productContext.frameworks&&productContext.frameworks.length?productContext.frameworks.join(', '):'';
  const fwLine=frameworks?'Reference frameworks: '+frameworks+'\nUse framework-aligned capability naming where applicable.\n':'';
  const indLine=industry?'Industry: '+industry+'\n':'';
  return 'Product: '+product+'\n'+indLine+fwLine+'NSM: '+nsm+'\nTarget metric: "'+metric+'" ('+stage+')\n'+(refinement?'PM context: '+refinement+'\n':'')+
  '\nReturn ONLY this JSON:\n{"capabilities":[{"name":"...","why":"why this moves the metric","features":[{"name":"...","why":"how this feature delivers it"}]}]}\n'+
  'Rules: 2-4 capabilities based on what genuinely matters for this metric, 2-4 features each, all specific to '+product+', never generic. Do not pad with capabilities just to hit a number. CRITICAL: every capability MUST include its features array — never return an empty features array.';
}

function renderCapabilities(data){
  const c=document.getElementById('cap-content');
  if(!data||!data.capabilities||!data.capabilities.length){c.innerHTML='<div class="cap-error">No capabilities returned. Try refining.</div>';return;}
  document.getElementById('cap-refine-txt').value='';
  let h='';
  data.capabilities.forEach((cap,ci)=>{
    if(ci>0)h+='<div class="cap-sep"></div>';
    h+='<div class="cap-block"><div class="cap-num-row"><div class="cap-num">'+(ci+1)+'</div><div class="cap-name">'+e(cap.name)+'</div></div>';
    h+='<div class="cap-why">'+e(cap.why)+'</div><div class="feat-list">';
    const features=cap.features||[];
    if(features.length===0){
      h+='<div class="cap-feat-missing"><i class="ti ti-alert-circle" style="font-size:11px;" aria-hidden="true"></i> Features missing — <button class="cap-feat-regen-btn" onclick="loadCapabilities(\'\')">Regenerate</button></div>';
    } else {
      features.forEach(f=>{
        const fid=scMakeFeatureId(capMetric,cap.name,f.name);
        const isOnCanvas=scCanvas.some(x=>x.id===fid);
        h+='<div class="feat-item'+(isOnCanvas?' on-canvas':'')+'" id="fi-'+e(fid)+'"'+
          ' data-fid="'+e(fid)+'"'+
          ' data-metric="'+e(capMetric)+'"'+
          ' data-stage="'+e(capStage)+'"'+
          ' data-cap="'+e(cap.name)+'"'+
          ' data-fname="'+e(f.name)+'"'+
          ' data-fwhy="'+e(f.why)+'">';
        h+='<div class="feat-item-check'+(isOnCanvas?' checked':'')+'" onclick="event.stopPropagation();scToggleFeatureFromDrawer(this)"></div>';
        h+='<div class="feat-item-body"><div class="feat-name">'+e(f.name)+'</div><div class="feat-why">'+e(f.why)+'</div></div>';
        h+='</div>';
      });
    }
    h+='</div></div>';
  });
  c.innerHTML=h;
  scUpdateCapDrawerFooter();
}

