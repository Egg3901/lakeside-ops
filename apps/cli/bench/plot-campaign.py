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
fig.text(.065,.885,'Which model earns its time and cost?',fontsize=26,weight='bold')
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
