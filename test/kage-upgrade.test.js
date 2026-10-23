import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('upgrade merges old divisions once, preserves IFJs, access, account passwords and completed migrations',async()=>{
 const db=new PGlite();
 try{
  const sql=async name=>db.exec(await readFile(new URL('../src/'+name,import.meta.url),'utf8'));
  await sql('schema.sql');
  await db.exec("INSERT INTO staff(username,password_hash,role) VALUES('admin','old-hash','admin'); INSERT INTO members(ifj,name,game_nick,roblox_username,discord_id,division,verified) VALUES('000000000000001','Um','Um','RobloxUm','111111111111111111',1,TRUE),('000000000000002','Dois','Dois','RobloxDois','222222222222222222',2,TRUE)");
  await db.exec("CREATE TABLE member_accounts(id SERIAL PRIMARY KEY, member_id INTEGER UNIQUE NOT NULL REFERENCES members(id) ON DELETE CASCADE, username TEXT UNIQUE NOT NULL, discord_id TEXT NOT NULL, password_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()); INSERT INTO member_accounts(member_id,username,discord_id,password_hash) VALUES(1,'conta-antiga','111111111111111111','original-password-hash'); INSERT INTO confirmations(token,member_id,discord_id,guild_id,expires_at) VALUES('old-confirmation',1,'111111111111111111','333333333333333333',now()+interval '1 hour')");
  for(const name of ['district-schema.sql','sbi-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql'])await sql(name);
  let members=(await db.query('SELECT * FROM members ORDER BY id')).rows;
  assert.deepEqual(members.map(m=>m.ifj),['000000000000001','000000000000002']);assert.ok(members.every(m=>m.division===1&&m.verified&&m.migration_required&&m.identity_version===2));assert.equal((await db.query('SELECT * FROM confirmations')).rows.length,0);
  const identities=members.map(m=>[m.idrkc,m.card_secret]);assert.ok(identities.every(([id,key])=>/^\d{16}$/.test(id)&&key));
  await db.exec("UPDATE members SET name='Nome Shigaku',migration_required=FALSE,district_migrated_at=now(),identity_version=3 WHERE id=1; INSERT INTO staff(username,password_hash,role) VALUES('vice','hash','sublider'); INSERT INTO member_accounts(member_id,discord_id,password_hash) VALUES(2,'222222222222222222','new-password-hash'); UPDATE member_accounts SET active=FALSE WHERE member_id=1");
  for(const name of ['schema.sql','district-schema.sql','sbi-schema.sql','member-portal-schema.sql','idrkc-schema.sql','verified-services-schema.sql','embed-publications-schema.sql'])await sql(name);
  members=(await db.query('SELECT * FROM members ORDER BY id')).rows;
  assert.equal(members[0].ifj,'000000000000001');assert.equal(members[0].name,'Nome Shigaku');assert.equal(members[0].identity_version,3);assert.equal(members[0].migration_required,false);assert.equal(members[1].identity_version,2);
  assert.deepEqual(members.map(m=>[m.idrkc,m.card_secret]),identities);
  const account=(await db.query('SELECT * FROM member_accounts WHERE member_id=1')).rows[0];assert.equal(account.username,'conta-antiga');assert.equal(account.password_hash,'original-password-hash');assert.equal(account.active,false);assert.equal((await db.query('SELECT * FROM application_migrations')).rows.length,1);
 }finally{await db.close();}
});
