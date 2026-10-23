// Presentation only: an avatar must never change the account's name or permissions.
export async function accountDiscordProfile(bot,discordId){
 if(typeof discordId!=='string'||!/^\d{17,20}$/.test(discordId)||typeof bot.getDiscordProfile!=='function')return null;
 try{
  const profile=await bot.getDiscordProfile(discordId);
  if(!profile||profile.id!==discordId)return null;
  return {id:profile.id,username:profile.username,display_name:profile.display_name,avatar_url:profile.avatar_url};
 }catch{return null;}
}
