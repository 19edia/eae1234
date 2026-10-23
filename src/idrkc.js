import {createHmac,timingSafeEqual} from 'node:crypto';
import {decodeCardBarcode} from './barcode.js';

// Stable signed credential shared by HBCode and previously issued Code 128 cards:
// 4 magic/version digits + 16 IDRKC digits + 10 revision digits + 30 MAC digits.
const PREFIX='7201';
const PAYLOAD_PATTERN=/^7201[0-9]{56}$/;
export const IDRKC_PATTERN=/^[0-9]{16}$/;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class CardVerificationError extends Error {
 constructor(code,message,status=400){super(message);this.name='CardVerificationError';this.code=code;this.status=status;}
}
export const publicCardMember=member=>{
 if(!member)return member;
 const {card_secret,...safe}=member;
 return safe;
};
export const formatIdrkc=value=>IDRKC_PATTERN.test(String(value))?String(value).match(/.{4}/g).join(' '):'HB-ID indisponível';
function identityReady(member){
 if(!member||!IDRKC_PATTERN.test(member.idrkc)||!UUID_PATTERN.test(String(member.card_secret))||!/^\d{17,20}$/.test(String(member.discord_id)))throw new CardVerificationError('CARD_NOT_READY','A identidade HB-ID ainda não está pronta. Atualize o cadastro antes de emitir a carteira.',409);
}
function revisionOf(value){
 const n=Number(value);
 if(!Number.isInteger(n)||n<1||n>2147483647)throw new CardVerificationError('CARD_VERSION_INVALID','Versão da carteira inválida. Solicite uma nova carteira.',409);
 return n;
}
function payloadForVersion(member,revision){
 identityReady(member);
 const version=String(revisionOf(revision)).padStart(10,'0');
 const header=`${PREFIX}${member.idrkc}${version}`;
 // The UUID is the private signing key. The HMAC also binds the Discord owner.
 const key=Buffer.from(member.card_secret.replaceAll('-',''),'hex');
 const mac=createHmac('sha256',key).update(`IDRKC/v1/${header}/${member.discord_id}`,'utf8').digest().subarray(0,12);
 return header+BigInt('0x'+mac.toString('hex')).toString(10).padStart(30,'0');
}
export function buildCardPayload(member){return payloadForVersion(member,member.identity_version??1);}
export function parseCardPayload(payload){
 if(typeof payload!=='string'||!PAYLOAD_PATTERN.test(payload))throw new CardVerificationError('CARD_BARCODE_INVALID','O código não pertence a uma carteira HB-ID válida.');
 return {idrkc:payload.slice(4,20),version:revisionOf(payload.slice(20,30))};
}
// Caller may pass a Pool or its transaction client; no credential is returned to HTTP clients.
export async function ensureIdrkcIdentity(c,memberId){
 const {rows}=await c.query('SELECT * FROM members WHERE id=$1',[Number(memberId)]);
 if(!rows[0])throw new CardVerificationError('CARD_REVOKED','Esta carteira foi revogada ou seu cadastro não existe mais.',403);
 identityReady(rows[0]);return rows[0];
}
export async function verifyCardPayload(pool,payload,{discordId,requireVerified=true,lock=false}={}){
 if(typeof discordId!=='string'||!/^\d{17,20}$/.test(discordId))throw new CardVerificationError('CARD_OWNER_REQUIRED','Não foi possível identificar o titular no Discord.',403);
 const parsed=parseCardPayload(payload);
 // Use lock:true only with the caller's open transaction, then write the verified request
 // before committing. This prevents revocation/ownership edits racing the privileged action.
 const {rows}=await pool.query(`SELECT * FROM members WHERE idrkc=$1${lock?' FOR SHARE':''}`,[parsed.idrkc]);
 const member=rows[0];
 if(!member||member.card_revoked_at)throw new CardVerificationError('CARD_REVOKED','Esta carteira foi revogada ou seu cadastro não existe mais.',403);
 const expected=payloadForVersion(member,parsed.version);
 if(!timingSafeEqual(Buffer.from(payload,'ascii'),Buffer.from(expected,'ascii')))throw new CardVerificationError('CARD_SIGNATURE_INVALID','O código da carteira é inválido ou foi alterado. Envie o arquivo original recebido pelo bot.',403);
 if(member.discord_id!==discordId)throw new CardVerificationError('CARD_WRONG_OWNER','Envie a sua própria carteira. Esta carteira pertence a outro usuário do Discord.',403);
 if(revisionOf(member.identity_version??1)!==parsed.version)throw new CardVerificationError('CARD_STALE','Sua carteira está desatualizada. Use /ver-sua-carteira e envie a nova imagem.',409);
 if(requireVerified&&!member.verified)throw new CardVerificationError('CARD_NOT_VERIFIED','Seu cadastro ainda não está verificado. Fale com a administração.',403);
 return publicCardMember(member);
}
// Decode the actual pixels, then verify their authenticated ID against the current database row.
// HBCode proves an issued credential, not the surrounding image's visible text.
// Always display the returned database name/rank to administrators, never trust text in the upload.
export async function verifyCardBuffer(pool,buffer,options={}){
 const payload=await decodeCardBarcode(buffer);
 return verifyCardPayload(pool,payload,options);
}
