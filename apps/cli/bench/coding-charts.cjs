'use strict';
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function charts(result){
 const models=result.models.slice().sort((a,b)=>(a.groups.optimized.medianSeconds??Infinity)-(b.groups.optimized.medianSeconds??Infinity)),modes=['native','old','optimized'],colors=['#94a3b8','#f59e0b','#38bdf8'],names=['Native','Old Keir','Optimized'];
 const panels=[{name:'Median wall-clock per qualified ticket (seconds)',value:g=>g.medianSeconds,format:x=>x.toFixed(1)+'s'},{name:'Recorded tokens, all trials per mode (includes cached/repeated input)',value:g=>g.priced?g.promptTokens+g.outputTokens:null,format:x=>(x/1000).toFixed(1)+'k'},{name:'Known API-equivalent cost, all trials per mode (USD)',value:g=>g.priced?g.knownUSD:null,format:x=>'$'+x.toFixed(3)}];
 let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 840" role="img" aria-label="Keir coding benchmark latency, tokens and API-equivalent costs"><rect width="1040" height="840" fill="#0b1320"/><g font-family="system-ui,sans-serif" fill="#e2e8f0">';
 svg+='<text x="35" y="32" font-size="23" font-weight="bold">Keir coding benchmark: before and after</text>';
 for(let i=0;i<3;i++)svg+=`<rect x="${620+i*135}" y="48" width="14" height="14" fill="${colors[i]}"/><text x="${640+i*135}" y="60" font-size="13">${names[i]}</text>`;
 panels.forEach((p,index)=>{const top=108+index*230,height=145,bottom=top+height,max=Math.max(...models.flatMap(m=>modes.map(mode=>p.value(m.groups[mode])||0)),.0001)*1.22;
  svg+=`<text x="35" y="${top-16}" font-size="16" font-weight="bold">${escape(p.name)}</text><line x1="60" x2="1010" y1="${bottom}" y2="${bottom}" stroke="#334155"/>`;
  for(let t=1;t<=3;t++){const y=bottom-height*t/3;svg+=`<line x1="60" x2="1010" y1="${y}" y2="${y}" stroke="#334155" stroke-opacity=".4"/>`;}
  models.forEach((m,j)=>{const center=170+j*240;svg+=`<text x="${center}" y="${bottom+23}" text-anchor="middle" font-size="14">${escape(m.label)}</text>`;
   modes.forEach((mode,i)=>{const g=m.groups[mode],v=p.value(g),x=center-65+i*43;if(v===null){svg+=`<text data-value="unknown" x="${x+17}" y="${bottom-15}" text-anchor="middle" fill="${colors[i]}" font-size="12" transform="rotate(-90 ${x+17} ${bottom-15})">Unknown</text>`;return;}
    const h=v/max*height;svg+=`<rect data-value="${v}" x="${x}" y="${bottom-h}" width="34" height="${h}" fill="${colors[i]}"><title>${escape(m.label+' / '+names[i]+': '+p.format(v)+'; '+g.qualified+'/'+g.recorded+' qualified; '+g.priced+'/'+g.recorded+' priced')}</title></rect><text x="${x+17}" y="${bottom-h-6}" text-anchor="middle" fill="${colors[i]}" font-size="12">${escape(p.format(v))}</text>`;
   });
  });
 });
 svg+='<text x="35" y="807" font-size="12" fill="#94a3b8">Medians exclude unqualified runs. Unknown usage is never plotted as zero. Costs are estimates, not subscription charges.</text><text x="35" y="827" font-size="12" fill="#94a3b8">Two synthetic repair tasks; root and sandbox. Small samples include provider variance. Hover bars for coverage.</text></g></svg>';
 return svg;
}
module.exports={charts};
