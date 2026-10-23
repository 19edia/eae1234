import {EmbedBuilder} from 'discord.js';
import {BRAND_NAME,DISTRICT_NAME,BRAND_COLOR} from './brand.js';
// One visual identity for every Discord embed, with readable titles and native fields.
export class RokuharaEmbed extends EmbedBuilder {
 constructor(division=0){super();this.setAuthor({name:`${BRAND_NAME} • CENTRAL HB-ID`});this.setColor(BRAND_COLOR);super.setFooter({text:`${DISTRICT_NAME} • União, respeito e lealdade`});this.setTimestamp();}
 setTitle(value){return super.setTitle(value?`❖ ┃ ${value}`.slice(0,256):value);}
 setFooter(value){return super.setFooter(value?.text?{...value,text:value.text.includes(BRAND_NAME)?value.text:`${BRAND_NAME} • ${value.text}`}:value);}
}
