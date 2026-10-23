export {DISTRICT_NAME} from './brand.js';
import {DISTRICT_NAME,BRAND_COLOR} from './brand.js';
export const DISTRICT_COLOR=BRAND_COLOR;
const idOK=id=>/^\d{17,20}$/.test(id||'');
const uniqueIds=ids=>[...new Set(ids.filter(idOK))];
function applySnapshot(config,row){
 const state={...(row.state||{}),id:1,name:DISTRICT_NAME,guild:row.guild_id||undefined};
 config.sbi=true;config.sbiState=row.guild_id?state:null;config.sbiStatus=row.status;
 config.sourceGuilds=uniqueIds([...(config.sourceGuilds||[]),...(row.source_guilds||[])]).filter(id=>id!==row.guild_id);
 config.divisions.splice(0,config.divisions.length,...(row.status==='ready'&&idOK(row.guild_id)?[state]:[]));
 return state;
}
export async function loadSbiConfig(pool,config){
 await pool.query("INSERT INTO sbi_district(singleton,source_guilds) VALUES(TRUE,$1) ON CONFLICT(singleton) DO NOTHING",[JSON.stringify(config.sourceGuilds||[])]);
 const {rows}=await pool.query('SELECT * FROM sbi_district WHERE singleton=TRUE');
 if(!rows[0])throw new Error('SBI_STATE_MISSING');
 applySnapshot(config,rows[0]);return config;
}
export async function saveSbiDistrict(pool,config,district,{complete=false}={}){
 if(!idOK(district.guild))throw new Error('SBI_GUILD_INVALID');
 const sources=uniqueIds([...(config.sourceGuilds||[]),config.sbiState?.guild,config.legacyDistrict?.guild]).filter(id=>id!==district.guild);
 const state={...district,id:1,name:DISTRICT_NAME};
 const {rows}=await pool.query("UPDATE sbi_district SET guild_id=$1,source_guilds=$2,state=$3,status=$4,updated_at=now() WHERE singleton=TRUE RETURNING *",[state.guild,JSON.stringify(sources),JSON.stringify(state),complete?'ready':'configuring']);
 if(!rows[0])throw new Error('SBI_STATE_MISSING');
 applySnapshot(config,rows[0]);return state;
}
export async function canConfigureDestination(pool,config,guildId,discordId){
 const configured=config.sbiState?.guild||config.divisions[0]?.guild;
 const sources=config.sourceGuilds||[];
 if(configured===guildId||!configured&&(config.legacyDistrict?.guild?config.legacyDistrict.guild===guildId:!sources.length||sources.includes(guildId)))return true;
 const {rows}=await pool.query("SELECT id FROM staff WHERE active=TRUE AND role IN ('admin','sublider') AND discord_id=$1 AND discord_verified_at IS NOT NULL LIMIT 1",[discordId]);
 return rows.length>0;
}
