import {spawnSync} from 'node:child_process';
// Called only after the workflow commits its explicit metadata allowlist.
// Never force-push, discard conflicts or publish without tests on the rebased tree.
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Metadata publication runs only in the reviewed GitHub workflow');
const run=(command,args)=>spawnSync(command,args,{stdio:'inherit'}).status;
if(run('git',['diff','--exit-code','HEAD'])!==0)throw Error('Unexpected uncommitted tracked changes');
let published=false;
for(let attempt=0;attempt<3;attempt++){
 if(run('git',['fetch','origin','main'])!==0)throw Error('Cannot refresh publication base');
 if(run('git',['rebase','origin/main'])!==0)throw Error('Metadata conflicts require review; no publication attempted');
 if(run('npm',['test'])!==0)throw Error('Rebased metadata failed validation');
 if(run('git',['push','origin','HEAD:main'])===0){published=true;break;}
}
if(!published)throw Error('Metadata publication raced with other updates; retry reconciliation');
