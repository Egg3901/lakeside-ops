"use strict";
function claim(jobs, now, leaseMs, token) {
 const job=jobs.find(j=>j.state==='queued'||j.state==='running');
 if(!job)return null;
 job.state='running';job.attempts=(job.attempts||0)+1;job.leaseUntil=now+leaseMs;job.leaseToken=token;return job;
}
function complete(jobs,id,token,result){const j=jobs.find(j=>j.id===id);if(!j)return false;j.state='done';j.result=result;return true;}
module.exports={claim,complete};
