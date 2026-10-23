export const GAMES=Object.freeze([
 Object.freeze({id:'westbound',name:'Westbound'}),
 Object.freeze({id:'deepwoken',name:'Deepwoken'}),
 Object.freeze({id:'klase',name:'Klase'})
]);
export const gameById=id=>GAMES.find(game=>game.id===id);
