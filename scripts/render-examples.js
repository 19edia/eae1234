import {mkdir,writeFile} from 'node:fs/promises';
import {renderCard} from '../src/cards.js';
import {DISTRICT_NAME} from '../src/brand.js';
// Fictional preview only. Production keys always come from gen_random_uuid() in PostgreSQL.
const base={id:42,name:'Aster Voss',game_nick:'Aster Voss',roblox_username:'AsterDeepwoken',discord_id:'123456789012345678',ifj:'000123456789012',idrkc:'1042000000000042',card_secret:'be3dc854-77cc-4a62-856f-0493f58e84a5',identity_version:2,created_at:'2026-09-22T12:00:00Z',verified:true,suspect:false,account_kind:'membro',member_rank:'Membro'};
await mkdir(new URL('../../EXEMPLOS/',import.meta.url),{recursive:true});
for(const [name,changes] of [['membro',{}],['lider',{member_rank:'Líder'}],['sub-lider',{member_rank:'Sub líder'}],['high-member',{member_rank:'High member'}],['aliado',{account_kind:'aliado',member_rank:'Aliado',allied_gang:'Guilda Exemplo'}]]){
 await writeFile(new URL(`../../EXEMPLOS/carteira-${name}.png`,import.meta.url),await renderCard({...base,...changes},DISTRICT_NAME,{issuedAt:new Date('2026-10-15T12:00:00Z')}));
}
