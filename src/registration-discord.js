const fail=(message,status=503)=>Object.assign(new Error(message),{status});

// Query the configured district, never an arbitrary Discord user directory.
export function createRegistrationMemberSearch(client,config){
 return async function searchRegistrationMembers(value){
  if(!client.isReady())throw fail('O bot ainda não está conectado. Aguarde e tente novamente.');
  const query=String(value??'').trim().replace(/^@/,'');
  if(query.length<2||query.length>80||/[\u0000-\u001f\u007f]/.test(query))throw fail('Digite seu nome de usuário do Discord.',400);
  const guildIds=[...new Set(config.divisions.map(d=>d.guild).filter(Boolean))];
  if(!guildIds.length)throw fail('A equipe precisa configurar o distrito antes do cadastro.',409);
  const profiles=new Map();
  for(const id of guildIds){
   const guild=await client.guilds.fetch(id);
   let members;
   if(/^\d{17,20}$/.test(query)){
    const member=await guild.members.fetch({user:query,force:true}).catch(error=>{if(Number(error.code)===10007)return null;throw error;});
    members=member?[member]:[];
   }else members=(await guild.members.search({query,limit:8})).values();
   for(const member of members){
    const user=member.user;
    if(!user||user.bot)continue;
    profiles.set(user.id,{id:user.id,username:user.username,display_name:member.displayName||user.globalName||user.username,avatar_url:member.displayAvatarURL({extension:'png',size:128})});
    if(profiles.size>=8)break;
   }
   if(profiles.size>=8)break;
  }
  return [...profiles.values()];
 };
}
