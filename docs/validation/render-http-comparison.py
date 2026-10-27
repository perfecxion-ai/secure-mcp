# Render the checked-in diagnostic data with matplotlib 3.11.2.
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(__file__).resolve().parent
series=[('24.13.0, default heap','2026-10-27-http-node24-old-progress.jsonl','#b45309'),('24.13.0, 256 MiB heap','2026-10-27-http-node24-old-bounded-progress.jsonl','#64748b'),('24.22.1, 256 MiB heap','2026-10-27-http-node24-current-progress.jsonl','#047857')]
fig,axs=plt.subplots(2,1,figsize=(10,7),sharex=True,layout='constrained')
for label,file,color in series:
 rows=[json.loads(x) for x in (root/file).read_text().splitlines()]
 rows=[r for r in rows if r['progress']<=910]
 axs[0].plot([r['progress']/60 for r in rows],[r['memory']['clientRssKiB']/1024 for r in rows],label=label,color=color,linewidth=2)
 previous={'progress':0,'calls':0}
 x=[];y=[]
 for row in rows:
  x.append(row['progress']/60)
  y.append((row['calls']-previous['calls'])/(row['progress']-previous['progress']))
  previous=row
 axs[1].plot(x,y,color=color,linewidth=2)
axs[0].set_ylabel('Driver resident memory (MiB)')
axs[0].legend(frameon=False,loc='upper left')
axs[1].set_ylabel('Calls per second\n(interval average)')
axs[1].set_xlabel('Elapsed minutes')
for ax in axs:
 ax.grid(alpha=.2)
 ax.set_xlim(0,15)
 ax.set_ylim(bottom=0)
 ax.spines[['top','right']].set_visible(False)
fig.suptitle('HTTP load-generator comparison on the guarded runtime',fontsize=15)
fig.supxlabel('Four clients, same ARM64 host, overlapping workloads. Observational comparison, not isolated capacity.',fontsize=9)
fig.savefig(root/'2026-10-27-http-driver-comparison.svg',metadata={'Date':'2026-10-27'})

