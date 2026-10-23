// Code-native crests, centered on (0, 0), contained within a 356 px seal.
// Keep the drawing independent from Discord roles and permission rules.
export function drawSpecialCrest(c,kind,{accent,bright}){
 c.save();
 const path=points=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();};
 const polygon=(points,fill,stroke,width=1)=>{path(points);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}};
 const line=(points,color,width=1)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke();};
 const metal=c.createLinearGradient(-120,-150,125,165);
 metal.addColorStop(0,kind==='leader'?'#fff5b5':bright);metal.addColorStop(.38,kind==='leader'?'#f9dd55':'#f8e16a');metal.addColorStop(.7,accent);metal.addColorStop(1,'#fff4a8');
 const star=(x,y,r)=>polygon([[x,y-r],[x+r*.3,y-r*.3],[x+r,y],[x+r*.3,y+r*.3],[x,y+r],[x-r*.3,y+r*.3],[x-r,y],[x-r*.3,y-r*.3]],metal);
 if(kind==='leader'){
  // A crowned command shield, framed by two branches of laurel.
  polygon([[0,-169],[139,-89],[148,82],[0,178],[-148,82],[-139,-89]],null,accent+'38');
  for(const side of [-1,1]){
   c.save();c.scale(side,1);c.beginPath();c.moveTo(57,161);c.bezierCurveTo(126,136,154,63,140,-41);c.strokeStyle=metal;c.lineWidth=3;c.stroke();
   for(const [x,y]of [[140,-12],[143,20],[140,52],[131,83],[116,113],[96,138]]){
    c.beginPath();c.moveTo(x,y);c.quadraticCurveTo(x+28,y-5,x+22,y-31);c.quadraticCurveTo(x-3,y-25,x,y);c.fillStyle=metal;c.fill();
    line([[x+2,y-3],[x+18,y-24]],'#595b22',1);
   }c.restore();
  }
  const shield=[[0,-70],[105,-33],[92,71],[0,146],[-92,71],[-105,-33]];
  polygon(shield,'#14190f',metal,4);
  polygon([[0,-57],[91,-23],[79,64],[0,128],[-79,64],[-91,-23]],null,accent+'65',1.5);
  polygon([[-88,-48],[-113,-133],[-49,-93],[0,-163],[49,-93],[113,-133],[88,-48]],metal);
  polygon([[-65,-68],[-74,-96],[-40,-75],[0,-125],[40,-75],[74,-96],[65,-68]],'#292a10');
  polygon([[-88,-48],[88,-48],[80,-26],[-80,-26]],metal);
  line([[-66,-39],[66,-39]],'#777622',2);
  for(const x of [-42,0,42])polygon([[x,-44],[x+5,-37],[x,-30],[x-5,-37]],'#14190f');
  star(0,-163,7);star(0,108,9);
  c.textAlign='center';c.textBaseline='middle';c.font='64px IFJBold';c.fillStyle=metal;c.fillText('HB',0,34);
  line([[-52,80],[52,80]],accent+'70',1.5);
 }else if(kind==='subleader'){
  // Deputy command: a star and two ascending chevrons, without the leader's crown.
  polygon([[0,-169],[132,-106],[149,47],[91,133],[0,174],[-91,133],[-149,47],[-132,-106]],null,accent+'35');
  for(const side of [-1,1]){
   c.save();c.scale(side,1);
   polygon([[120,-71],[153,-100],[156,-63],[128,-34]],metal);
   polygon([[128,-20],[160,-49],[156,-10],[126,18]],metal);
   polygon([[122,33],[152,6],[142,48],[111,76]],metal);
   line([[133,87],[98,124],[56,144]],accent+'85',2);
   c.restore();
  }
  polygon([[0,-116],[107,-71],[98,78],[0,155],[-98,78],[-107,-71]],'#14190f',metal,3);
  polygon([[0,-101],[92,-60],[84,70],[0,137],[-84,70],[-92,-60]],null,accent+'50',1.5);
  star(0,-130,32);
  for(const y of [-30,25]){
   polygon([[-70,y+29],[0,y-15],[70,y+29],[70,y+55],[0,y+11],[-70,y+55]],metal);
   line([[-57,y+29],[0,y-7],[57,y+29]],bright+'85',1.5);
  }
  c.textAlign='center';c.textBaseline='middle';c.font='26px IFJBold';c.fillStyle=bright;c.fillText('HB',0,103);
 }else if(kind==='high'){
  // High member: an orange faceted gemstone in a geometric prestige seal.
  polygon([[0,-176],[153,-87],[153,87],[0,176],[-153,87],[-153,-87]],null,accent+'35');
  for(const side of [-1,1]){
   c.save();c.scale(side,1);
   line([[84,-122],[132,-94],[153,-45]],metal,3);
   line([[150,42],[128,91],[84,122]],metal,3);
   polygon([[153,-19],[165,0],[153,19],[141,0]],metal);
   c.restore();
  }
  star(0,-156,15);star(0,156,10);
  const gem=[[-76,-78],[76,-78],[115,-14],[0,124],[-115,-14]];
  polygon(gem,'#4b4e20',metal,3);
  polygon([[-76,-78],[-34,-14],[-115,-14]],'#dcc532');
  polygon([[-76,-78],[0,-78],[-34,-14]],'#fff3b1');
  polygon([[0,-78],[76,-78],[34,-14],[-34,-14]],'#ffdf65');
  polygon([[76,-78],[115,-14],[34,-14]],'#d2b52b');
  polygon([[-115,-14],[-34,-14],[0,124]],'#877720');
  polygon([[-34,-14],[34,-14],[0,124]],metal);
  polygon([[34,-14],[115,-14],[0,124]],'#cdbd39');
  line([[-115,-14],[115,-14]],'#fff4a8',2);
  line([[-76,-78],[-34,-14],[0,124],[34,-14],[76,-78]],'#fff0a2',1.5);
  star(-43,-54,14);
 }else if(kind==='ally'){
  // A pact seal: two linked rings inside a faceted shield. The weaving
  // stroke at the crossing makes the connection clear at thumbnail size.
  c.beginPath();c.arc(0,0,166,0,Math.PI*2);c.strokeStyle=accent+'35';c.lineWidth=1.5;c.stroke();
  for(let n=0;n<8;n++){
   const a=n*Math.PI/4;c.beginPath();c.arc(0,0,154,a+.12,a+.43);c.strokeStyle=metal;c.lineWidth=4;c.stroke();
  }
  polygon([[0,-127],[107,-70],[103,67],[0,147],[-103,67],[-107,-70]],'#14190f',metal,3);
  polygon([[0,-111],[93,-61],[89,60],[0,128],[-89,60],[-93,-61]],null,accent+'45',1.5);
  star(0,-153,12);star(0,106,8);
  c.save();c.translate(0,-7);c.rotate(-Math.PI/4);
  const link=(x,y,color)=>{c.beginPath();c.roundRect(x,y,64,103,30);c.strokeStyle='#14190f';c.lineWidth=27;c.stroke();c.strokeStyle=color;c.lineWidth=19;c.stroke();};
  link(-58,-79,bright);link(-6,-19,accent);
  // Restore a short front edge of the upper link over the lower link.
  c.beginPath();c.moveTo(6,-37);c.lineTo(6,-8);c.strokeStyle='#14190f';c.lineWidth=27;c.stroke();c.strokeStyle=bright;c.lineWidth=19;c.stroke();
  c.restore();
  for(const side of [-1,1]){c.save();c.scale(side,1);polygon([[114,79],[129,84],[84,137],[72,125]],metal);polygon([[94,136],[88,147],[51,162],[54,147]],metal);c.restore();}
 }
 c.restore();
}
