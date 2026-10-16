#!/usr/bin/env python3
"""Render a Keir-bench campaign leaderboard. Optional dependency: matplotlib."""
import json, sys, math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, FixedLocator
measured='--measured-cost' in sys.argv
root=Path(sys.argv[1]); data=json.loads((root/'leaderboard.json').read_text())
models=data['models']; completed=[m for m in models if m['accuracy'] is not None]
colors=['#38bdf8','#fb923c','#a78bfa','#f472b6','#facc15','#2dd4bf','#818cf8','#e879f9','#f87171','#a3e635','#cbd5e1']
color={m['id']:colors[i%len(colors)] for i,m in enumerate(models)}
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'text.color':'#e2e8f0','axes.labelcolor':'#cbd5e1','xtick.color':'#94a3b8','ytick.color':'#94a3b8','axes.edgecolor':'#334155','svg.fonttype':'none'})
fig,axes=plt.subplots(1,2,figsize=(17,8.8),facecolor='#0b1220');fig.subplots_adjust(left=.065,right=.96,top=.78,bottom=.25,wspace=.20)
fig.text(.065,.94,'KEIR BENCH  /  NEW HARNESS',fontsize=12,color='#38bdf8',weight='bold')
fig.text(.065,.885,'New-harness model frontier',fontsize=26,weight='bold')
finished=len(completed);unavailable=[m['label'] for m in models if m['unavailable']]
fig.text(.065,.835,f'{finished} routes scored / {len(models)} requested, {len(unavailable)} unavailable   |   6 tasks x root + sandbox   |   correct completions / 12',fontsize=12,color='#94a3b8')
for ax,key,title,xlabel,frontierkey in [(axes[0], 'costPerAttemptUSD' if measured else 'listedBlendedPricePerMillion','Accuracy vs measured cost' if measured else 'Accuracy vs listed price','Estimated API USD per attempted task (log scale)' if measured else 'Listed API USD / 1M tokens, 3:1 input/output (log scale)','cost' if measured else 'listed'),(axes[1],'meanWallSeconds','Accuracy vs speed','Mean wall-clock seconds per attempted task','speed')]:
 ax.set_facecolor('#111c2e');ax.grid(True,color='#334155',alpha=.6,linewidth=.7);ax.set_axisbelow(True);ax.set_ylim(-5,110);ax.set_yticks(range(0,101,20));ax.yaxis.set_major_formatter(FuncFormatter(lambda x,pos:f'{x:g}%'));ax.set_ylabel('Fully correct completion rate');ax.set_xlabel(xlabel,labelpad=12);ax.set_title(title,loc='left',pad=18,fontsize=16,weight='bold',color='#f8fafc')
 points=[m for m in completed if m[key] is not None]
 if key in ('costPerAttemptUSD','listedBlendedPricePerMillion'):
  ax.set_xscale('log');ax.xaxis.set_major_locator(FixedLocator([.0001,.0002,.0005,.001,.002,.005,.01,.02,.05,.1,.2,.3,.5,1,2,3,5,10,20]));ax.xaxis.set_major_formatter(FuncFormatter(lambda x,pos:f'${x:.3g}'));ax.minorticks_off()
 if not points:ax.text(.5,.5,'Awaiting complete usage coverage',ha='center',va='center',transform=ax.transAxes,color='#94a3b8');continue
 values=[m[key] for m in points];lo,hi=min(values),max(values)
 if key in ('costPerAttemptUSD','listedBlendedPricePerMillion'):ax.set_xlim(max(lo*.55,1e-7),hi*2.2)
 else:ax.set_xlim(max(0,lo*.65),hi*1.40)
 frontier=[m for mid in data['frontiers'][frontierkey] for m in points if m['id']==mid]
 if frontier:ax.plot([m[key] for m in frontier],[m['accuracy'] for m in frontier],ls=(0,(3,3)),lw=2,color='#a3e635',alpha=.8,zorder=2)
 # Place labels in screen space; repel collisions vertically, retaining true point coordinates.
 fig.canvas.draw();placed=[]
 for m in sorted(points,key=lambda m:(-m['accuracy'],m[key])):
  x,y=m[key],m['accuracy'];isfront=m['id'] in data['frontiers'][frontierkey]
  ax.scatter(x,y,s=135 if isfront else 95,c=color[m['id']],edgecolors='#a3e635' if isfront else '#111827',linewidths=2 if isfront else 1,zorder=5)
  px,py=ax.transData.transform((x,y));tx=px+9;ty=py+12
  label=m['label'].replace(' Spark','').replace(' Preview','').replace('GPT-','GPT ')
  width=len(label)*6.4
  for attempt in range(30):
   if not any(abs(ty-oy)<17 and tx<ox+ow+8 and tx+width>ox-8 for ox,oy,ow in placed):break
   ty-=19
  placed.append((tx,ty,width));ax.annotate(label,(x,y),xytext=(tx-px,ty-py),textcoords='offset pixels',fontsize=9,color=color[m['id']],va='center',arrowprops={'arrowstyle':'-','color':color[m['id']],'lw':.6,'alpha':.65})
 ax.text(.03,.03,'Upper left is better  |  dotted line: Pareto frontier',transform=ax.transAxes,fontsize=9,color='#a3e635')
unknown=[m['label'] for m in completed if m['costPerAttemptUSD'] is None]
fig.text(.065,.16,'Pareto frontier: no measured model is both cheaper / faster and more accurate.',fontsize=11,color='#a3e635')
fig.text(.065,.12,('Cost uses dated API-equivalent rates and observed tokens, not subscription charges. Missing usage is unknown.' if measured else 'Listed price uses a fixed 3:1 token mix, no caching. Actual task costs and token coverage are reported separately.'),fontsize=10,color='#94a3b8')
fig.text(.065,.085,'All attempts count, including timeouts and incorrect answers. Small synthetic sample; no Elo or confidence of general superiority.',fontsize=10,color='#94a3b8')
notes=[]
if unknown and measured:notes.append('Cost omitted (incomplete usage): '+', '.join(unknown))
if unavailable:notes.append('Unavailable: '+', '.join(unavailable))
fig.text(.065,.045,'  |  '.join(notes) or 'Source and task fixtures frozen for this campaign.',fontsize=9,color='#64748b',wrap=True)
stem='pareto-measured-cost' if measured else 'pareto'
fig.savefig(root/(stem+'.png'),dpi=160,facecolor=fig.get_facecolor());fig.savefig(root/(stem+'.svg'),facecolor=fig.get_facecolor());plt.close(fig)

# Usage has incomplete coverage on several routes. Show observed subtotals,
# never invent zero usage or a token-efficiency frontier for those routes.
fig,ax=plt.subplots(figsize=(17,8.5),facecolor='#0b1220');fig.subplots_adjust(left=.19,right=.69,top=.78,bottom=.15)
ax.set_facecolor('#111c2e');ax.grid(axis='x',color='#334155',alpha=.6);ax.set_axisbelow(True)
fig.text(.065,.93,'KEIR BENCH  /  USAGE COVERAGE',fontsize=12,color='#38bdf8',weight='bold')
fig.text(.065,.865,'Recorded token usage and coverage',fontsize=25,weight='bold')
fig.text(.065,.815,'Subtotals across scored tasks only. Incomplete coverage is a lower bound, not an efficiency ranking.',fontsize=12,color='#94a3b8')
upper=max([m['observedTokenLowerBound'] or 0 for m in models]+[1]);ax.set_xlim(0,upper*1.1)
for i,m in enumerate(models):
 total=m['observedTokenLowerBound'];final=m['tokens'] or 0
 if total is not None:
  ax.barh(i,final,height=.6,color=color[m['id']],zorder=3)
  if total>final:ax.barh(i,total-final,left=final,height=.6,color=color[m['id']],alpha=.4,hatch='///',edgecolor=color[m['id']],zorder=3)
  usage=f"{total:,} observed; {m['tokenCoverage']}/{m['recorded']} final, {m['partialUsage']} partial"
  if m['observedCostLowerBoundUSD'] is not None:usage+=f"; API >= ${m['observedCostLowerBoundUSD']:.4f}"
 else:usage='provider unavailable' if m['unavailable'] else 'usage unknown' if m['recorded'] else m['status']
 ax.text(1.02,i,usage,transform=ax.get_yaxis_transform(),va='center',fontsize=10,color='#cbd5e1',clip_on=False)
ax.set_yticks(range(len(models)),[m['label'] for m in models]);ax.invert_yaxis();ax.set_xlabel('Observed tokens, including cached context and reported reasoning',labelpad=14);ax.xaxis.set_major_formatter(FuncFormatter(lambda x,pos:f'{x/1e6:.2f}M'))
fig.text(.065,.07,'Solid: finalized usage. Hatched: partial stream. Missing calls are excluded, never assigned zero. API amounts are lower-bound estimates.',fontsize=10,color='#94a3b8')
fig.savefig(root/'usage.png',dpi=160,facecolor=fig.get_facecolor());fig.savefig(root/'usage.svg',facecolor=fig.get_facecolor());plt.close(fig)

reviewed=[m for m in models if m.get('quality') and m['quality'].get('review')]
if reviewed:
 reviewed.sort(key=lambda m:-m['quality']['review']['total'])
 fig,ax=plt.subplots(figsize=(17,8.5),facecolor='#0b1220');fig.subplots_adjust(left=.19,right=.69,top=.77,bottom=.20)
 ax.set_facecolor('#111c2e');ax.grid(axis='x',color='#334155',alpha=.6);ax.set_axisbelow(True);ax.set_xlim(0,20)
 dimensions=list(reviewed[0]['quality']['review']['dimensions']);palette=['#38bdf8','#2dd4bf','#a78bfa','#fb923c','#f472b6']
 labels=['Readability','Invariants','Recovery design','Candidate tests','Engineering judgment']
 for i,m in enumerate(reviewed):
  left=0;q=m['quality'];review=q['review']
  for j,k in enumerate(dimensions):
   value=review['dimensions'][k]['score'];ax.barh(i,value,left=left,height=.62,color=palette[j],zorder=3,label=labels[j] if i==0 else None);left+=value
  ax.text(1.02,i,f"{review['total']}/20  |  {q['testsPassed']}/{q['tests']} checks  |  {q['seconds']:.1f}s  |  {'qualified' if q['qualified'] else 'not qualified'}",transform=ax.get_yaxis_transform(),va='center',fontsize=10,color='#cbd5e1',clip_on=False)
 ax.set_yticks(range(len(reviewed)),[m['label'] for m in reviewed]);ax.invert_yaxis();ax.set_xlabel('Subjective code-quality score / 20',labelpad=14);ax.set_xticks(range(0,21,4))
 fig.text(.065,.93,'KEIR BENCH  /  FIVE-MINUTE CODE CHALLENGE',fontsize=12,color='#38bdf8',weight='bold');fig.text(.065,.865,'Code quality under a five-minute cap',fontsize=25,weight='bold');fig.text(.065,.815,'One anonymized rubric review per output. Functional correctness and delivery are shown separately.',fontsize=12,color='#94a3b8')
 ax.legend(loc='upper center',bbox_to_anchor=(.75,-.12),ncol=3,frameon=False,fontsize=10)
 fig.text(.065,.05,'Five dimensions x 0..4. High effort requested; 300-second cap; identical task in sandbox. One judge, small sample; retain written reasons.',fontsize=10,color='#94a3b8')
 fig.savefig(root/'quality.png',dpi=160,facecolor=fig.get_facecolor());fig.savefig(root/'quality.svg',facecolor=fig.get_facecolor());plt.close(fig)
