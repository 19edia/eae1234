import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RokuharaEmbed} from '../src/embed-theme.js';
import {guideMessage} from '../src/community.js';
import {allianceMessage} from '../src/alliance-notice.js';
import {announcementMessage} from '../src/announcements.js';
import {panelPayload} from '../src/panels.js';
import {EmbedBuilder} from 'discord.js';
import {BRAND_COLOR,BRAND_NAME} from '../src/brand.js';
test('public embeds serialize within Discord limits and keep explicit safe mentions',()=>{
 const d={id:2,name:'2ª divisão',verification:'123456789012345678'};
 const messages=[guideMessage(d),allianceMessage(d,'https://discord.gg/example'),announcementMessage({id:1,kind:'war',payload:{gang:'W'.repeat(100),reason:'W'.repeat(1000)}},d),announcementMessage({id:2,kind:'wanted',payload:{title:'VIVO OU MORTO',name:'W'.repeat(100),nick:'W'.repeat(64),reason:'W'.repeat(1000),description:'W'.repeat(2000)}},d)];
 for(const message of messages){assert.deepEqual(message.allowedMentions,{parse:[]});for(const embed of message.embeds){const e=embed.toJSON();assert.ok(e.author.name.includes(BRAND_NAME));assert.ok(e.title.length<=256);assert.ok((e.description?.length??0)<=4096);for(const field of e.fields??[])assert.ok(field.value.length<=1024);assert.doesNotThrow(()=>new EmbedBuilder(panelPayload({embeds:[embed]},'guide').embeds[0]).toJSON());}}
 assert.equal(new RokuharaEmbed(1).toJSON().color,BRAND_COLOR);assert.equal(new RokuharaEmbed(2).toJSON().color,BRAND_COLOR);
 assert.equal(new RokuharaEmbed().setTitle('W'.repeat(256)).toJSON().title.length,256);
});
