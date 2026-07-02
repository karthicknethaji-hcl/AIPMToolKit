function downloadXLSX(){
  const rows=window._ddRows||[];if(!rows.length)return;
  if(typeof XLSX==='undefined'){const s=document.createElement('script');s.src='https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js';s.onload=()=>doXLSX(rows);document.head.appendChild(s);}
  else{doXLSX(rows);}
}
function doXLSX(rows){
  const headers=['Stage','Level','Metric','Why it matters','Definition','Benchmark','Red Flag'];
  const data=[headers,...rows.map(r=>[r.sl,r.lvl,r.name,r.why||'',r.def,r.bm,r.rf])];
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:14},{wch:8},{wch:28},{wch:32},{wch:36},{wch:20},{wch:24}];
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Metrics Document');
  const nameEl=document.getElementById('f-name');
  if(!nameEl)console.warn('[export-xlsx] #f-name missing at export time — falling back to sessionContext');
  const profileName=(typeof sessionContext!=='undefined'&&sessionContext&&sessionContext.productProfile&&sessionContext.productProfile.productName)||'';
  const name=((nameEl&&nameEl.value)?nameEl.value.trim():'')||profileName.trim()||'Product';
  XLSX.writeFile(wb,name.replace(/\s+/g,'_')+'_Metrics_Teardown.xlsx');
}
