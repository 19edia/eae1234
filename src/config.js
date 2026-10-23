import {validateEnvironment,ROLE_ENV} from './config-rules.js';
import {DISTRICT_NAME} from './sbi.js';
export class ConfigurationError extends Error{constructor(checks){super('Configuração inválida. Corrija as variáveis indicadas.');this.name='ConfigurationError';this.checks=checks;}}
export function readConfig(env=process.env,report=()=>{}){
 const checks=validateEnvironment(env);checks.forEach(report);if(checks.some(c=>!c.ok))throw new ConfigurationError(checks);
 const botEnabled=env.BOT_ENABLED!=='false';
 const get=s=>env[`DIV_1_${s}`]||'';
 const legacyDistrict={id:1,name:DISTRICT_NAME,guild:get('GUILD_ID'),memberRole:get('MEMBER_ROLE_ID'),adminRole:get('ADMIN_ROLE_ID'),allianceChannel:get('ALLIANCE_CHANNEL_ID'),invite:get('INVITE_URL'),verification:get('VERIFICATION_CHANNEL_ID'),welcome:get('WELCOME_CHANNEL_ID'),guide:get('GUIDE_CHANNEL_ID'),wanted:get('WANTED_CHANNEL_ID'),tickets:get('TICKETS_CHANNEL_ID'),reports:get('REPORTS_CHANNEL_ID'),category:get('TICKET_CATEGORY_ID'),staffChannel:get('STAFF_CHANNEL_ID'),rankRoles:Object.fromEntries(Object.entries(ROLE_ENV).map(([key,suffix])=>[key,get(suffix)]))};
 const sourceGuilds=[...new Set([get('GUILD_ID'),env.DIV_2_GUILD_ID,env.IMMIGRATION_GUILD_ID].filter(id=>/^\d{17,20}$/.test(id||'')))];
 const allianceInvite=env.ALLIANCE_INVITE_URL||'';
 const tryouts={enabled:true,evaluatorId:env.TRYOUT_EVALUATOR_DISCORD_ID||'1480009495915659494',passPercent:Number(env.TRYOUT_PASS_PERCENT??50),registrationHours:Number(env.TRYOUT_REGISTRATION_HOURS??48)};
 return {sbi:true,tryouts,sourceGuilds,legacyDistrict,hydraInvite:allianceInvite,oldAllyRole:'',immigrationGuild:'',production:env.NODE_ENV==='production',origin:env.APP_ORIGIN.replace(/\/$/,''),secret:env.SESSION_SECRET,database:env.DATABASE_URL,botEnabled,token:botEnabled?env.DISCORD_TOKEN:'',divisions:[],port:Number(env.PORT||3000)};
}
