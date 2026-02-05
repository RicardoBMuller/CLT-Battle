/* =========================================================
   A BATALHA DO CLT — Pokémon GBC vibe (Overworld + Battle)
   FIX PACK:
   - UI alinhada (safe-area) => nada corta no FIT
   - Criação de personagem: passo a passo, NOME com input direto
   - Avatar preview sempre atualiza cores/tipo de cabelo (sem sprite vazio)
   - TextBox/dialog sempre dentro do canvas
   - Battle HUD alinhado (player/enemy boxes)
   ========================================================= */

const W = 384;
const H = 216;
const ZOOM = 4;
const TILE = 16;

const SAFE_PAD = 8; // margem segura para não cortar no FIT

const PALETTE = {
  ink: 0x1b2632,
  ink2: 0x243244,
  paper: 0x0f141a,
  uiFill: 0x101a24,
  uiFill2: 0x0c121a,
  uiEdge: 0xcbd6e2,
  uiEdge2: 0x92a6bd,
  gold: 0xffdf7e,

  grass1: 0x3fa95a,
  grass2: 0x2f7f48,
  grass3: 0x24613a,

  path1: 0xd2b47c,
  path2: 0xb9955f,
  path3: 0x8a6b43,

  water1: 0x2a5ea1,
  water2: 0x1f4a83,
  water3: 0x16355f,

  roofRed1: 0xb14a44,
  roofRed2: 0x8a3632,
  roofBlue1: 0x4b6fb2,
  roofBlue2: 0x38578b,

  wall1: 0xf2ead7,
  wall2: 0xdccfb4,
  door1: 0x7a4b32,
  door2: 0x5e3624,

  flower1: 0xff6b6b,
  flower2: 0x7ee7ff,
  flower3: 0xffdf7e,

  tree1: 0x2b6a3b,
  tree2: 0x1f4f2c,
  tree3: 0x173a21,

  shadow: 0x000000
};

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rint(a,b){ return Math.floor(a + Math.random()*(b-a+1)); }
function chance(p){ return Math.random() < p; }

function shade(c, f){
  const r = (c>>16)&255, g=(c>>8)&255, b=c&255;
  const nr = clamp(Math.floor(r*(1+f)),0,255);
  const ng = clamp(Math.floor(g*(1+f)),0,255);
  const nb = clamp(Math.floor(b*(1+f)),0,255);
  return (nr<<16) | (ng<<8) | nb;
}

/* =========================================================
   XP CURVE (progressão mais lenta)
   ========================================================= */
function xpForNextLevel(level){
  return 60 + Math.floor(Math.pow(level, 1.6) * 45);
}

/* =========================================================
   Profissões por nível
   ========================================================= */
function professionForLevel(level){
  if (level >= 45){
    return state.careerChoice ? state.careerChoice : "Escolha: Presidente / Empreendedor";
  }
  if (level <= 4) return "Desempregado";
  if (level <= 9) return "Jovem Aprendiz";
  if (level <= 14) return "Estagiário";
  if (level <= 19) return "Analista JR.";
  if (level <= 24) return "Analista PL.";
  if (level <= 29) return "Analista SR.";
  if (level <= 34) return "Team Lead";
  if (level <= 39) return "Gerente";
  if (level <= 44) return "Diretor";
  return "Desempregado";
}

/* =========================================================
   STATE
   ========================================================= */
const state = {
  sexo: "masculino",
  nome: "Sem Nome",
  hairStyle: "curto",
  hairColor: 0x1e1b22,
  shirtColor: 0x3a8aa8,
  pantsColor: 0x2d3e55,
  shoeColor: 0x1b2632,

  level: 1,
  xp: 0,
  xpProx: xpForNextLevel(1),
  gold: 0,
  inv: { potion: 2, ether: 1, boost: 0 },
  careerChoice: null,

  stats: null,
  flags: { ato1Done:false, metNPC1:false }
};

function initStats(){
  state.stats = {
    forca: 5,
    defesa: 5,
    vidaMax: 26,
    vida: 26,
    inteligencia: 4,
    manaMax: 8,
    mana: 8,
    destreza: 4,
    agilidade: 4,
    sorte: 2
  };
}

/* =========================================================
   AUDIO
   ========================================================= */
const Audio = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  started: false,
  musicTimer: null,
  musicType: "none",

  ensure(){
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85; // mais alto
    this.master.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.40;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1.00;
    this.sfxGain.connect(this.master);
  },

  async start(){
    this.ensure();
    if (this.ctx.state !== "running"){
      try { await this.ctx.resume(); } catch {}
    }
    this.started = true;
  },

  stopMusic(){
    if (this.musicTimer){
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicType = "none";
  },

  tone(freq, dur=0.08, type="square", vol=0.22, slideTo=null){
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;

    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo){
      o.frequency.linearRampToValueAtTime(slideTo, t + dur);
    }

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(g);
    g.connect(this.sfxGain);

    o.start(t);
    o.stop(t + dur + 0.02);
  },

  noise(dur=0.05, vol=0.14){
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;

    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++){
      data[i] = (Math.random()*2 - 1) * (1 - i/bufferSize);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const g = this.ctx.createGain();
    g.gain.value = vol;

    src.connect(g);
    g.connect(this.sfxGain);

    src.start(t);
    src.stop(t + dur);
  },

  sfx(name){
    if (!this.started) return;
    switch(name){
      case "ui_move":  this.tone(660,0.05,"square",0.18, 520); break;
      case "ui_ok":    this.tone(880,0.07,"square",0.26); this.tone(1320,0.06,"square",0.18); break;
      case "ui_back":  this.tone(420,0.07,"square",0.22, 320); break;
      case "step":     this.tone(180,0.03,"triangle",0.14, 140); break;
      case "encounter":this.noise(0.07,0.18); this.tone(220,0.12,"square",0.22, 440); break;
      case "hit":      this.noise(0.05,0.26); this.tone(220,0.07,"square",0.24, 120); break;
      case "heal":     this.tone(523,0.08,"triangle",0.25); this.tone(659,0.08,"triangle",0.22); break;
      case "win":      this.tone(659,0.10,"square",0.24); this.tone(784,0.10,"square",0.24); this.tone(988,0.12,"square",0.24); break;
      case "lose":     this.tone(196,0.14,"square",0.26,110); this.noise(0.08,0.20); break;
      case "attack":   this.tone(392,0.05,"square",0.26); this.noise(0.03,0.14); break;
      case "crit":     this.tone(1318,0.06,"square",0.26); this.tone(1760,0.06,"square",0.24); break;
      case "coin":     this.tone(988,0.05,"square",0.24); this.tone(1244,0.05,"square",0.20); break;
      case "spark":    this.tone(1046,0.06,"triangle",0.24); this.tone(1568,0.08,"triangle",0.20); break;
      default: break;
    }
  },

  playMusic(type){
    if (!this.started) return;
    if (this.musicType === type) return;

    this.stopMusic();
    this.musicType = type;

    const ctx = this.ctx;
    let step = 0;

    const playNote = (freq, dur, wave, vol)=>{
      const t = ctx.currentTime;

      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(freq, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t+dur);

      o.connect(g);
      g.connect(this.musicGain);

      o.start(t);
      o.stop(t + dur + 0.02);
    };

    const freq = (n)=> 440 * Math.pow(2, (n-69)/12);

    const serene = { bpm: 92,
      lead: [72, 74, 76, 74, 72, 69, 67, 69, 72, 74, 76, 79, 76, 74, 72, 69],
      bass: [48, 48, 55, 55, 50, 50, 57, 57],
    };

    const battle = { bpm: 146,
      lead: [76, 79, 83, 79, 76, 74, 71, 74, 76, 79, 83, 86, 83, 79, 76, 74],
      bass: [43, 43, 46, 46, 41, 41, 46, 46],
    };

    const data = (type==="battle") ? battle : serene;
    const stepDur = (60 / data.bpm) / 2;

    this.musicTimer = setInterval(()=>{
      const iLead = step % data.lead.length;
      const iBass = step % data.bass.length;

      const nLead = data.lead[iLead];
      const nBass = data.bass[iBass];

      if (step % 4 === 0){
        playNote(freq(nBass), stepDur*1.4, "triangle", 0.085);
      }
      playNote(freq(nLead), stepDur*0.95, "square", (type==="battle") ? 0.105 : 0.078);

      if (type==="battle" && step % 2 === 0){
        this.noise(0.02, 0.065);
      }

      step++;
    }, stepDur * 1000);
  }
};

/* =========================================================
   ART / TEXTURES
   ========================================================= */
function makeTex(scene, key, w, h, paint){
  const g = scene.make.graphics({x:0,y:0,add:false});
  g.clear();
  paint(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

function ditherRect(g, x, y, w, h, c1, c2, a=1){
  for (let yy=y; yy<y+h; yy++){
    for (let xx=x; xx<x+w; xx++){
      const pick = ((xx+yy)&1) ? c1 : c2;
      const noisy = (Math.random() < 0.06);
      g.fillStyle(noisy ? c2 : pick, a);
      g.fillRect(xx, yy, 1, 1);
    }
  }
}

function roughBorder(g, x, y, w, h, color, a=1){
  g.fillStyle(color, a);
  for (let i=0;i<w;i++){
    if (Math.random() < 0.9) g.fillRect(x+i, y, 1, 1);
    if (Math.random() < 0.9) g.fillRect(x+i, y+h-1, 1, 1);
  }
  for (let j=0;j<h;j++){
    if (Math.random() < 0.9) g.fillRect(x, y+j, 1, 1);
    if (Math.random() < 0.9) g.fillRect(x+w-1, y+j, 1, 1);
  }
}

function genArt(scene){
  makeTex(scene, "tile_ground", TILE, TILE, (g)=>{
    ditherRect(g,0,0,TILE,TILE,PALETTE.grass3,shade(PALETTE.grass3,-0.08),1);
    for(let i=0;i<7;i++){
      g.fillStyle(shade(PALETTE.grass3,0.10),0.35);
      g.fillRect(rint(1,14), rint(1,14), 1,1);
    }
    roughBorder(g,0,0,TILE,TILE,shade(PALETTE.ink,0.05),0.75);
  });

  makeTex(scene, "tile_grass", TILE, TILE, (g)=>{
    ditherRect(g,0,0,TILE,TILE,PALETTE.grass1,PALETTE.grass2,1);
    for(let i=0;i<11;i++){
      g.fillStyle(shade(PALETTE.grass1,0.15),0.40);
      g.fillRect(rint(1,14), rint(2,14), 1, rint(1,2));
    }
    roughBorder(g,0,0,TILE,TILE,PALETTE.grass3,0.85);
  });

  makeTex(scene, "tile_path", TILE, TILE, (g)=>{
    ditherRect(g,0,0,TILE,TILE,PALETTE.path1,PALETTE.path2,1);
    for(let i=0;i<10;i++){
      g.fillStyle(PALETTE.path3,0.35);
      g.fillRect(rint(1,14), rint(1,14), 1,1);
    }
    roughBorder(g,0,0,TILE,TILE,shade(PALETTE.path3,-0.15),0.8);
  });

  makeTex(scene, "tile_water", TILE, TILE, (g)=>{
    ditherRect(g,0,0,TILE,TILE,PALETTE.water1,PALETTE.water2,1);
    for(let i=0;i<6;i++){
      g.fillStyle(PALETTE.flower2,0.18);
      g.fillRect(rint(2,13), rint(2,13), rint(1,2), 1);
    }
    roughBorder(g,0,0,TILE,TILE,PALETTE.water3,0.9);
  });

  makeTex(scene, "tile_flower", TILE, TILE, (g)=>{
    ditherRect(g,0,0,TILE,TILE,PALETTE.grass1,PALETTE.grass2,1);
    const cols = [PALETTE.flower1, PALETTE.flower2, PALETTE.flower3];
    const c = cols[rint(0, cols.length-1)];
    g.fillStyle(c, 0.9);
    g.fillRect(7,7,2,2); g.fillRect(9,7,2,2); g.fillRect(8,9,2,2);
    roughBorder(g,0,0,TILE,TILE,PALETTE.grass3,0.85);
  });

  makeTex(scene, "tile_fence", TILE, TILE, (g)=>{
    ditherRect(g,0,0,TILE,TILE,PALETTE.grass3,shade(PALETTE.grass3,-0.08),1);
    g.fillStyle(PALETTE.path3,0.9);
    g.fillRect(2,6,12,2);
    g.fillRect(2,12,12,2);
    g.fillRect(3,6,2,8);
    g.fillRect(11,6,2,8);
    roughBorder(g,0,0,TILE,TILE,PALETTE.ink,0.75);
  });

  makeTex(scene, "tile_tree", TILE, TILE, (g)=>{
    ditherRect(g,0,0,TILE,TILE,PALETTE.grass3,shade(PALETTE.grass3,-0.08),1);
    ditherRect(g,2,2,12,10,PALETTE.tree1,PALETTE.tree2,1);
    g.fillStyle(PALETTE.tree3,0.35);
    for (let i=0;i<10;i++) g.fillRect(rint(3,12), rint(3,10), 1,1);
    ditherRect(g,7,11,2,4,PALETTE.door1,PALETTE.door2,1);
    roughBorder(g,0,0,TILE,TILE,PALETTE.ink2,0.75);
  });

  function makeHouse(key, roofA, roofB){
    makeTex(scene, key, 48, 48, (g)=>{
      ditherRect(g,0,0,48,48,shade(PALETTE.paper,0.2),PALETTE.paper,1);
      ditherRect(g,6,6,36,16,roofA,roofB,1);
      g.fillStyle(shade(roofA,-0.18),0.35);
      for (let x=8; x<=40; x+=6) g.fillRect(x,8,1,12);
      ditherRect(g,8,22,32,20,PALETTE.wall1,PALETTE.wall2,1);
      ditherRect(g,12,28,12,8,shade(PALETTE.water1,0.15),PALETTE.water2,1);
      ditherRect(g,28,28,10,14,PALETTE.door1,PALETTE.door2,1);
      g.fillStyle(PALETTE.shadow,0.45); g.fillRect(32,38,1,1);
      roughBorder(g,1,1,46,46,PALETTE.ink2,0.85);
      g.fillStyle(0xffffff,0.04); g.fillRect(6,6,36,10);
    });
  }
  makeHouse("house_red", PALETTE.roofRed1, PALETTE.roofRed2);
  makeHouse("house_blue", PALETTE.roofBlue1, PALETTE.roofBlue2);

  makeTex(scene, "npc", 16, 20, (g)=>{
    g.fillStyle(PALETTE.shadow,0.35); g.fillRect(4,18,8,2);
    g.fillStyle(0x17245d,1); g.fillRect(4,7,8,9);
    g.fillStyle(0xf2c9a5,1); g.fillRect(5,2,6,6);
    g.fillStyle(0x17181f,1); g.fillRect(4,2,8,3);
    roughBorder(g,1,1,14,18,PALETTE.ink2,0.65);
  });

  // UI BOXES (safe width)
  const BOX_W = W - SAFE_PAD*2;
  makeTex(scene, "ui_box_safe", BOX_W, 64, (g)=>{
    ditherRect(g,0,0,BOX_W,64,PALETTE.uiFill,PALETTE.uiFill2,1);
    roughBorder(g,2,2,BOX_W-4,60,PALETTE.uiEdge2,0.95);
    roughBorder(g,4,4,BOX_W-8,56,PALETTE.uiEdge,0.65);
    g.fillStyle(0xffffff,0.04); g.fillRect(8,8,BOX_W-16,14);
  });

  makeTex(scene, "ui_small", 148, 44, (g)=>{
    ditherRect(g,0,0,148,44,PALETTE.uiFill,PALETTE.uiFill2,1);
    roughBorder(g,2,2,144,40,PALETTE.uiEdge2,0.95);
    roughBorder(g,4,4,140,36,PALETTE.uiEdge,0.65);
    g.fillStyle(0xffffff,0.04); g.fillRect(8,8,132,10);
  });

  makeTex(scene, "ui_menu", 170, 60, (g)=>{
    ditherRect(g,0,0,170,60,PALETTE.uiFill,PALETTE.uiFill2,1);
    roughBorder(g,2,2,166,56,PALETTE.uiEdge2,0.95);
    roughBorder(g,4,4,162,52,PALETTE.uiEdge,0.65);
  });

  makeTex(scene, "paper_noise", 128, 128, (g)=>{
    ditherRect(g,0,0,128,128,shade(PALETTE.paper,0.35),PALETTE.paper,1);
    g.fillStyle(0xffffff,0.03);
    for (let i=0;i<600;i++) g.fillRect(rint(0,127), rint(0,127), 1,1);
  });

  makeTex(scene, "battle_bg_forest", W, H, (g)=>{
    ditherRect(g,0,0,W,70,shade(PALETTE.flower2,-0.35),shade(PALETTE.flower2,-0.55),1);
    g.fillStyle(0xffffff,0.05); for (let x=0;x<W;x+=2) g.fillRect(x,68,1,1);

    for (let i=0;i<22;i++){
      const x = rint(0,W);
      const y = rint(40,90);
      const ww = rint(24,46);
      const hh = rint(18,28);
      ditherRect(g, x, y, ww, hh, shade(PALETTE.tree2,-0.12), shade(PALETTE.tree3,0.05), 1);
    }

    ditherRect(g,0,90,W,H-90,PALETTE.grass2,PALETTE.grass3,1);

    for (let i=0;i<90;i++){
      const x=rint(0,W-1), y=rint(92,H-10);
      const c = [PALETTE.grass1, PALETTE.grass2, PALETTE.flower3][rint(0,2)];
      g.fillStyle(c,0.25); g.fillRect(x,y,1,1);
    }

    roughBorder(g,2,2,W-4,H-4,PALETTE.ink2,0.45);
  });

  makeTex(scene, "bike", 48, 18, (g)=>{
    g.fillStyle(0x000000,0.50); g.fillCircle(10,14,4); g.fillCircle(36,14,4);
    g.fillRect(12,10,18,2);
    g.fillRect(22,6,3,8);
    g.fillRect(28,8,10,2);
    g.fillRect(20,2,6,6);
    g.fillStyle(0xff4d4d,0.45);
    g.fillRect(30,2,10,8);
    roughBorder(g,1,1,46,16,PALETTE.ink2,0.35);
  });

  makeEnemy(scene, "enemy_slime", { aura:PALETTE.flower2, hood:false, bag:false, knife:false, eyes:"normal" });
  makeEnemy(scene, "enemy_trombadinha", { aura:PALETTE.flower3, hood:true, bag:false, knife:true, eyes:"mean" });
  makeEnemy(scene, "enemy_motoboy", { aura:PALETTE.flower1, hood:false, bag:true, knife:false, eyes:"normal" });
}

function makeEnemy(scene, keyBase, style){
  for (let f=0; f<2; f++){
    makeTex(scene, `${keyBase}_${f}`, 56, 56, (g)=>{
      ditherRect(g,0,0,56,56,shade(PALETTE.paper,0.25),PALETTE.paper,1);

      g.fillStyle(style.aura,0.10);
      g.fillCircle(28,30,24);

      g.fillStyle(0x8ecae6,0.30);
      g.fillCircle(28,30,18);
      g.fillStyle(0x5fa8d3,0.58);
      g.fillRoundedRect(14,16,28,30,12);

      g.fillStyle(0xffffff,0.08);
      g.fillCircle(22,22,6);

      if (style.hood){
        g.fillStyle(PALETTE.ink,0.55);
        g.fillRoundedRect(13,14,30,18,8);
        g.fillStyle(PALETTE.ink,0.75);
        g.fillRect(18,20,20,8);
        g.fillStyle(0xffffff,0.08);
        g.fillRect(24,28,1,6);
        g.fillRect(31,28,1,6);
      }

      if (style.bag){
        g.fillStyle(0xff4d4d,0.55);
        g.fillRoundedRect(34,22,14,16,3);
        g.fillStyle(PALETTE.ink,0.25);
        g.fillRect(36,24,10,12);
        g.fillStyle(0xffffff,0.09);
        g.fillRect(37,28,8,2);
        g.fillStyle(PALETTE.ink,0.35);
        g.fillRect(30,22,4,2);
      }

      g.fillStyle(PALETTE.ink,0.9);
      if (style.eyes === "mean"){
        g.fillRect(20,28,8,1);
        g.fillRect(30,28,8,1);
      }
      g.fillRect(22,30,4,4);
      g.fillRect(32,30,4,4);

      if (style.knife){
        g.fillStyle(0xffffff,0.14);
        g.fillRect(40,38,6,1);
        g.fillStyle(PALETTE.ink,0.25);
        g.fillRect(39,39,3,2);
      }

      g.fillStyle(0xff6b6b,0.65);
      g.fillRect(25,40,6, (f===0?2:3));

      roughBorder(g,2,2,52,52,PALETTE.ink2,0.70);
    });
  }
}

/* =========================================================
   PLAYER (gerado por cor + cabelo)
   ========================================================= */
const HAIR_STYLES = [
  { id:"curto", label:"Curto" },
  { id:"comprido", label:"Comprido" },
  { id:"careca", label:"Careca" },
  { id:"moicano", label:"Moicano" },
  { id:"black", label:"Black" }
];

const COLOR_SWATCHES = [
  { name:"Preto",   value:0x1e1b22 },
  { name:"Castanho",value:0x3a2a1f },
  { name:"Loiro",   value:0xd8c08a },
  { name:"Roxo",    value:0x6b2d5c },
  { name:"Azul",    value:0x2f4f7f },
  { name:"Verde",   value:0x2a7f62 },
  { name:"Vermelho",value:0xb14a44 },
  { name:"Cinza",   value:0x9aa6b2 },
  { name:"Amarelo", value:0xffdf7e }
];

function playerTexKey(sexo, hairStyle, hair, shirt, pants, shoes, frame){
  return `pl_${sexo}_${hairStyle}_${hair.toString(16)}_${shirt.toString(16)}_${pants.toString(16)}_${shoes.toString(16)}_${frame}`;
}

function makePlayerTex(scene, key, sexo, hairStyle, hairColor, shirtColor, pantsColor, shoeColor, frame){
  const legOff = (frame%2===0) ? 0 : 1;

  makeTex(scene, key, 16, 20, (g)=>{
    g.fillStyle(PALETTE.shadow,0.35); g.fillRect(4,18,8,2);

    g.fillStyle(shoeColor,1);
    g.fillRect(4+legOff,18,3,1);
    g.fillRect(9-legOff,18,3,1);

    g.fillStyle(pantsColor,1);
    g.fillRect(5+legOff,15,2,3);
    g.fillRect(9-legOff,15,2,3);

    g.fillStyle(shirtColor,1); g.fillRect(4,7,8,9);
    g.fillStyle(shade(shirtColor,-0.25),0.85); g.fillRect(4,9,8,4);

    g.fillStyle(0xf2c9a5,1); g.fillRect(5,2,6,6);

    const drawHairBase = ()=>{
      g.fillStyle(hairColor,1);
      g.fillRect(4,2,8,3);
      if (sexo === "feminino"){
        g.fillRect(4,5,2,4); g.fillRect(10,5,2,4);
      }
    };

    if (hairStyle === "careca"){
      g.fillStyle(PALETTE.ink,0.10);
      g.fillRect(5,2,6,1);
    } else if (hairStyle === "curto"){
      drawHairBase();
    } else if (hairStyle === "comprido"){
      drawHairBase();
      g.fillStyle(hairColor,1);
      g.fillRect(4,6,2,6);
      g.fillRect(10,6,2,6);
      g.fillRect(5,6,6,2);
    } else if (hairStyle === "moicano"){
      g.fillStyle(hairColor,1);
      g.fillRect(7,2,2,7);
      g.fillRect(6,3,4,2);
    } else if (hairStyle === "black"){
      g.fillStyle(hairColor,1);
      g.fillCircle(8,4,5);
      g.fillRect(4,4,8,3);
    } else {
      drawHairBase();
    }

    roughBorder(g,1,1,14,18,PALETTE.ink2,0.65);
  });
}

function ensurePlayerTextures(scene){
  for (let f=0; f<4; f++){
    const key = playerTexKey(state.sexo, state.hairStyle, state.hairColor, state.shirtColor, state.pantsColor, state.shoeColor, f);
    if (!scene.textures.exists(key)){
      makePlayerTex(scene, key, state.sexo, state.hairStyle, state.hairColor, state.shirtColor, state.pantsColor, state.shoeColor, f);
    }
  }
}

/* =========================================================
   Ink bleed
   ========================================================= */
function addInkBleed(scene, target, color=PALETTE.ink2, alpha=0.35){
  const s = scene.add.sprite(target.x+1, target.y+1, target.texture.key)
    .setOrigin(target.originX, target.originY)
    .setScale(target.scaleX, target.scaleY)
    .setDepth((target.depth || 0) - 1)
    .setTint(color)
    .setAlpha(alpha);

  s._follow = target;

  scene.events.on("update", ()=>{
    if (!s.active || !s._follow?.active) return;
    const jx = (Math.random()<0.35) ? 1 : 0;
    const jy = (Math.random()<0.35) ? 1 : 0;
    s.x = s._follow.x + 1 + jx;
    s.y = s._follow.y + 1 + jy;
    s.setTexture(s._follow.texture.key);
  });

  return s;
}

/* =========================================================
   TextBox (SAFE)
   ========================================================= */
class TextBox {
  constructor(scene){
    this.scene = scene;
    this.container = scene.add.container(0,0).setScrollFactor(0).setDepth(3000);

    const boxW = W - SAFE_PAD*2;
    this.box = scene.add.image(W/2, H-32, "ui_box_safe").setOrigin(0.5);

    this.nameText = scene.add.text(SAFE_PAD+10, H-62, "", {
      fontFamily:"monospace", fontSize:"10px", color:"#d8e0ea"
    }).setScrollFactor(0);

    this.mainText = scene.add.text(SAFE_PAD+10, H-48, "", {
      fontFamily:"monospace", fontSize:"10px", color:"#eef3f7",
      wordWrap:{ width: boxW - 20 }
    }).setScrollFactor(0);

    this.arrow = scene.add.text(W - SAFE_PAD - 18, H-18, "▶", {
      fontFamily:"monospace", fontSize:"10px", color:"#ffdf7e"
    }).setScrollFactor(0);
    this.arrow.setVisible(false);

    this.container.add([this.box, this.nameText, this.mainText, this.arrow]);
    this.container.setVisible(false);

    this.active = false;
    this.lines = [];
    this.iLine = 0;
    this.full = "";
    this.shown = "";
    this.typeSpeed = 12;
    this.timer = 0;
    this.doneLine = false;
    this.onDone = null;
  }

  start(lines, onDone){
    this.lines = lines;
    this.iLine = 0;
    this.onDone = onDone || (()=>{});
    this.active = true;
    this.container.setVisible(true);
    Audio.sfx("ui_ok");
    this.nextLine();
  }

  nextLine(){
    const line = this.lines[this.iLine];
    if (!line){ this.stop(); return; }
    this.nameText.setText(line.name ? (line.name + ":") : "");
    this.full = line.text || "";
    this.shown = "";
    this.mainText.setText("");
    this.timer = 0;
    this.doneLine = false;
    this.arrow.setVisible(false);
  }

  stop(){
    this.active = false;
    this.container.setVisible(false);
    const cb = this.onDone; this.onDone = null;
    cb && cb();
  }

  advance(){
    if (!this.active) return;
    Audio.sfx("ui_move");
    if (!this.doneLine){
      this.shown = this.full;
      this.mainText.setText(this.shown);
      this.doneLine = true;
      this.arrow.setVisible(true);
      return;
    }
    this.iLine++;
    if (this.iLine >= this.lines.length){ this.stop(); return; }
    this.nextLine();
  }

  update(dt){
    if (!this.active || this.doneLine) return;
    this.timer += dt;
    while (this.timer >= this.typeSpeed){
      this.timer -= this.typeSpeed;
      if (this.shown.length < this.full.length){
        this.shown += this.full[this.shown.length];
        this.mainText.setText(this.shown);
      } else {
        this.doneLine = true;
        this.arrow.setVisible(true);
        break;
      }
    }
  }
}

/* =========================================================
   Wipe transition
   ========================================================= */
function wipeToScene(scene, nextKey, data){
  const g = scene.add.graphics().setDepth(9999).setScrollFactor(0);
  const w = W, h = H;

  const jag = [];
  for (let i=0;i<18;i++) jag.push(rint(-6,6));

  scene.tweens.add({
    targets: { t: 0 },
    t: 1,
    duration: 360,
    ease: "Sine.easeInOut",
    onUpdate: (tw, obj)=>{
      const t = obj.t;
      const x = -w + t*(w*2);

      g.clear();
      g.fillStyle(0x000000, 1);

      g.beginPath();
      g.moveTo(x, 0);
      for (let yy=0; yy<=h; yy+=12){
        const j = jag[(yy/12)|0] || 0;
        g.lineTo(x + w + j, yy);
      }
      g.lineTo(x, h);
      g.closePath();
      g.fillPath();
    },
    onComplete: ()=>{
      scene.scene.start(nextKey, data);
    }
  });
}

/* =========================================================
   RPG chances
   ========================================================= */
function hitChancePlayer(){
  const s = state.stats;
  return clamp(0.88 + s.destreza*0.012 + s.agilidade*0.004, 0.75, 0.98);
}
function evadeChanceEnemy(enemy){
  const s = state.stats;
  const base = enemy.evd || 0.08;
  return clamp(base - s.destreza*0.006, 0.02, 0.18);
}
function evadeChancePlayer(){
  const s = state.stats;
  return clamp(0.05 + s.agilidade*0.010, 0.05, 0.30);
}
function critChance(){
  const s = state.stats;
  return clamp(0.04 + s.sorte*0.008, 0.04, 0.22);
}
function runChance(){
  const s = state.stats;
  return clamp(0.35 + s.agilidade*0.03, 0.35, 0.82);
}
function calcDamage(att, def){
  const base = Math.max(1, att - Math.floor(def*0.65));
  const variance = 0.85 + Math.random()*0.3;
  return Math.max(1, Math.floor(base * variance));
}
function playerPhysical(enemy){
  const s = state.stats;
  if (!chance(hitChancePlayer())) return { miss:true };
  if (chance(evadeChanceEnemy(enemy))) return { evaded:true };
  const dmgBase = calcDamage(s.forca + Math.floor(state.level*0.55), enemy.def);
  const isCrit = chance(critChance());
  const dmg = isCrit ? Math.floor(dmgBase * 1.55) : dmgBase;
  return { dmg, crit:isCrit };
}
function playerMagic(enemy){
  const s = state.stats;
  const cost = 3;
  if (s.mana < cost) return { fail:true, msg:"Mana insuficiente!" };
  s.mana -= cost;

  if (!chance(hitChancePlayer())) return { miss:true };
  if (chance(evadeChanceEnemy(enemy))) return { evaded:true };

  const dmgBase = calcDamage((s.inteligencia*2) + Math.floor(state.level*0.55), enemy.def);
  const isCrit = chance(critChance() * 0.8);
  const dmg = isCrit ? Math.floor(dmgBase * 1.45) : dmgBase;
  return { dmg, crit:isCrit };
}
function enemyAttack(enemy){
  const s = state.stats;
  if (chance(evadeChancePlayer())) return { evaded:true };
  const dmg = calcDamage(enemy.att, s.defesa + Math.floor(state.level*0.22));
  return { dmg };
}
function giveGoldForWin(enemy){
  const s = state.stats;
  const base = enemy.goldBase || 8;
  const scale = Math.floor(state.level*1.1);
  const luck = Math.floor(s.sorte*1.1);
  const amount = base + rint(1, 6) + scale + luck;
  state.gold += amount;
  Audio.sfx("coin");
  return amount;
}
function gainXP(scene, amount){
  state.xp += amount;
  while (state.xp >= state.xpProx){
    state.xp -= state.xpProx;
    state.level += 1;
    state.xpProx = xpForNextLevel(state.level);

    state.stats.vida = state.stats.vidaMax;
    state.stats.mana = state.stats.manaMax;

    const resumeKey = scene.scene.key;
    scene.scene.pause(resumeKey);
    scene.scene.launch("LevelUpScene", { resumeKey });
  }
}

/* =========================================================
   HP bar
   ========================================================= */
function hpColor(p){
  if (p > 0.5) return 0x67d46f;
  if (p > 0.2) return 0xf2d16b;
  return 0xff6b6b;
}
function drawHPBar(scene, x, y, w, h, cur, max, depth=2000){
  const p = clamp(cur/max, 0, 1);
  const g = scene.add.graphics().setDepth(depth).setScrollFactor(0);
  g.fillStyle(PALETTE.uiFill2, 0.9);
  g.fillRect(x,y,w,h);
  g.fillStyle(PALETTE.uiEdge2, 1);
  g.fillRect(x,y,w,1);
  g.fillRect(x,y+h-1,w,1);
  g.fillRect(x,y,1,h);
  g.fillRect(x+w-1,y,1,h);
  g.fillStyle(hpColor(p), 1);
  g.fillRect(x+1, y+1, Math.floor((w-2)*p), h-2);
  return g;
}

/* =========================================================
   ENEMIES
   ========================================================= */
function pickEnemy(){
  const choices = [
    { key:"enemy_slime", name:"CLT Slime", hpBase: 18, attBase: 4, defBase: 2, evd:0.07, xpBase: 24, goldBase: 7 },
    { key:"enemy_trombadinha", name:"Trombadinha", hpBase: 16, attBase: 5, defBase: 2, evd:0.10, xpBase: 28, goldBase: 9 },
    { key:"enemy_motoboy", name:"Motoboy do iFood", hpBase: 22, attBase: 6, defBase: 3, evd:0.06, xpBase: 36, goldBase: 12 }
  ];
  const roll = Math.random();
  let pick = choices[0];
  if (roll > 0.55 && roll <= 0.82) pick = choices[1];
  else if (roll > 0.82) pick = choices[2];
  return pick;
}
function applyDiademaNerf(enemy){
  enemy.hpMax = Math.max(10, Math.floor(enemy.hpMax * 0.82));
  enemy.hp = enemy.hpMax;
  enemy.att = Math.max(2, Math.floor(enemy.att * 0.78));
  enemy.def = Math.max(1, Math.floor(enemy.def * 0.85));
  enemy.xp = Math.max(10, Math.floor(enemy.xp * 0.92));
  enemy.goldBase = Math.max(4, Math.floor(enemy.goldBase * 0.90));
}

/* =========================================================
   SCENES
   ========================================================= */
class BootScene extends Phaser.Scene {
  constructor(){ super("Boot"); }
  create(){
    initStats();
    genArt(this);
    this.scene.start("Title");
  }
}

/* -----------------------------
   Title
   ----------------------------- */
class TitleScene extends Phaser.Scene {
  constructor(){ super("Title"); }
  create(){
    this.add.image(W/2, H/2, "battle_bg_forest").setOrigin(0.5);
    const paper = this.add.tileSprite(0,0,W,H,"paper_noise").setOrigin(0,0).setAlpha(0.12);
    paper.setBlendMode(Phaser.BlendModes.MULTIPLY);

    const logo = this.add.text(W/2, 60, "A BATALHA\nDO CLT", {
      fontFamily:"monospace",
      fontSize:"28px",
      color:"#eef3f7",
      align:"center",
      lineSpacing: -6
    }).setOrigin(0.5);
    logo.setStroke("#000000", 6);
    logo.setShadow(2,2,"#000",4,false,true);

    const sub = this.add.text(W/2, 106, "Sampa • Diadema", {
      fontFamily:"monospace", fontSize:"10px", color:"#ffdf7e"
    }).setOrigin(0.5);
    sub.setShadow(1,1,"#000",2,false,true);

    // botão iniciar (safe)
    this.btnBox = this.add.image(W/2, 140, "ui_small").setOrigin(0.5).setScale(1.1, 1);
    this.btnTxt = this.add.text(W/2, 154, "▶ INICIAR", {
      fontFamily:"monospace", fontSize:"12px", color:"#eef3f7"
    }).setOrigin(0.5);
    this.btnTxt.setShadow(1,1,"#000",2,false,true);

    this.help = this.add.text(W/2, 196, "ENTER = confirmar    ↑↓ = navegar", {
      fontFamily:"monospace", fontSize:"9px", color:"#d8e0ea"
    }).setOrigin(0.5);
    this.help.setShadow(1,1,"#000",2,false,true);

    this.keys = this.input.keyboard.addKeys({
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER
    });

    // Start audio on first key
    this.input.keyboard.once("keydown", async ()=>{
      await Audio.start();
      Audio.playMusic("serene");
    });

    this.time.addEvent({
      delay: 350, loop:true,
      callback: ()=>{
        this.btnTxt.setText(this.btnTxt.text.startsWith("▶") ? "  INICIAR" : "▶ INICIAR");
      }
    });
  }

  update(){
    if (Phaser.Input.Keyboard.JustDown(this.keys.enter)){
      Audio.sfx("ui_ok");
      wipeToScene(this, "CreateWizard", {});
    }
  }
}

/* -----------------------------
   CreateWizard (limpo, previsível)
   - No passo NOME: digitação direta (sem “modo confuso”)
   - Preview sempre tem textura válida e atualiza certinho
   ----------------------------- */
class CreateWizardScene extends Phaser.Scene {
  constructor(){ super("CreateWizard"); }

  create(){
    this.add.image(W/2, H/2, "battle_bg_forest").setOrigin(0.5);
    const paper = this.add.tileSprite(0,0,W,H,"paper_noise").setOrigin(0,0).setAlpha(0.12);
    paper.setBlendMode(Phaser.BlendModes.MULTIPLY);

    // painel safe (não corta)
    this.panel = this.add.image(W/2, 118, "ui_box_safe").setOrigin(0.5).setScale(1, 1.85);

    this.title = this.add.text(W/2, 22, "Criação do Personagem", {
      fontFamily:"monospace", fontSize:"12px", color:"#ffdf7e"
    }).setOrigin(0.5);
    this.title.setShadow(1,1,"#000",2,false,true);

    // preview box (safe)
    this.previewShadow = this.add.rectangle(78, 114, 92, 98, 0x000000, 0.22).setOrigin(0.5);
    this.previewShadow.setStrokeStyle(2, 0x000000, 0.35);

    // preview sprite começa com NPC (textura válida) e troca depois
    this.previewSprite = this.add.sprite(78, 160, "npc").setOrigin(0.5,1).setScale(4);

    // textos
    this.prompt = this.add.text(144, 62, "", { fontFamily:"monospace", fontSize:"10px", color:"#d8e0ea" });
    this.value  = this.add.text(144, 82, "", { fontFamily:"monospace", fontSize:"12px", color:"#eef3f7" });
    this.sub    = this.add.text(144, 104, "", { fontFamily:"monospace", fontSize:"9px", color:"#d8e0ea", wordWrap:{ width: W-144-SAFE_PAD } });

    [this.prompt,this.value,this.sub].forEach(t=>t.setShadow(1,1,"#000",2,false,true));

    // linha de swatches (5 visíveis)
    this.swatchLabel = this.add.text(144, 136, "", { fontFamily:"monospace", fontSize:"9px", color:"#d8e0ea" });
    this.swatchLabel.setShadow(1,1,"#000",2,false,true);

    this.swatchGroup = this.add.container(0,0);
    this.swatchBoxes = []; // {rect, stroke, txt}
    this.swatchName  = this.add.text(144, 166, "", { fontFamily:"monospace", fontSize:"9px", color:"#eef3f7" });
    this.swatchName.setShadow(1,1,"#000",2,false,true);

    // hint
    this.hint = this.add.text(W/2, 202, "↑↓ navegar   ←→ alterar   ENTER confirmar   ESC voltar", {
      fontFamily:"monospace", fontSize:"9px", color:"#d8e0ea"
    }).setOrigin(0.5);
    this.hint.setShadow(1,1,"#000",2,false,true);

    // modal confirm
    this.modal = this.add.container(0,0).setDepth(9000).setVisible(false);
    const dim = this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.65).setOrigin(0.5);
    const box = this.add.image(W/2, H/2, "ui_box_safe").setOrigin(0.5).setScale(0.92, 1.15);
    const t1 = this.add.text(W/2, H/2 - 24, "Iniciar a Aventura", { fontFamily:"monospace", fontSize:"12px", color:"#ffdf7e" }).setOrigin(0.5);
    const t2 = this.add.text(W/2, H/2 + 4, "", { fontFamily:"monospace", fontSize:"11px", color:"#eef3f7" }).setOrigin(0.5);
    t1.setShadow(1,1,"#000",2,false,true);
    t2.setShadow(1,1,"#000",2,false,true);
    this.modalText = t2;
    this.modal.add([dim, box, t1, t2]);

    // wizard
    this.step = 0;
    this.steps = [
      "nome",
      "sexo",
      "cabelo_tipo",
      "cabelo_cor",
      "camiseta_cor",
      "calca_cor",
      "calcado_cor",
      "continuar"
    ];

    // buffers/indices
    this.nameBuffer = state.nome === "Sem Nome" ? "" : state.nome;

    this.sexIndex = state.sexo === "masculino" ? 0 : 1;
    this.hairStyleIndex = Math.max(0, HAIR_STYLES.findIndex(h=>h.id===state.hairStyle));
    this.hairColorIndex = Math.max(0, COLOR_SWATCHES.findIndex(c=>c.value===state.hairColor));
    this.shirtColorIndex = Math.max(0, COLOR_SWATCHES.findIndex(c=>c.value===state.shirtColor));
    this.pantsColorIndex = Math.max(0, COLOR_SWATCHES.findIndex(c=>c.value===state.pantsColor));
    this.shoeColorIndex  = Math.max(0, COLOR_SWATCHES.findIndex(c=>c.value===state.shoeColor));

    this.inModal = false;
    this.modalChoice = 0;

    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
      esc: Phaser.Input.Keyboard.KeyCodes.ESC,
      backspace: Phaser.Input.Keyboard.KeyCodes.BACKSPACE
    });

    // digitação do nome (somente no step nome)
    this.input.keyboard.on("keydown", (e)=>{
      if (this.inModal) return;
      if (this.steps[this.step] !== "nome") return;

      if (e.key === "Backspace"){
        this.nameBuffer = this.nameBuffer.slice(0, -1);
        Audio.sfx("ui_move");
        this.refresh();
        return;
      }
      if (e.key === "Enter" || e.key === "Escape") return;

      if (e.key.length === 1){
        const allowed = /[a-zA-ZÀ-ÿ0-9 _-]/.test(e.key);
        if (!allowed) return;
        if (this.nameBuffer.length >= 14) return;
        this.nameBuffer += e.key;
        Audio.sfx("ui_move");
        this.refresh();
      }
    });

    this.applyStateFromWizard();
    this.refresh();
  }

  applyStateFromWizard(){
    state.sexo = this.sexIndex===0 ? "masculino" : "feminino";
    state.hairStyle = HAIR_STYLES[this.hairStyleIndex].id;
    state.hairColor = COLOR_SWATCHES[this.hairColorIndex].value;
    state.shirtColor = COLOR_SWATCHES[this.shirtColorIndex].value;
    state.pantsColor = COLOR_SWATCHES[this.pantsColorIndex].value;
    state.shoeColor = COLOR_SWATCHES[this.shoeColorIndex].value;
    state.nome = (this.nameBuffer.trim().length ? this.nameBuffer.trim() : "Sem Nome");

    ensurePlayerTextures(this);

    // sempre garante textura válida
    const tex = playerTexKey(state.sexo, state.hairStyle, state.hairColor, state.shirtColor, state.pantsColor, state.shoeColor, 0);
    if (this.textures.exists(tex)) this.previewSprite.setTexture(tex);
  }

  clearSwatches(){
    this.swatchGroup.removeAll(true);
    this.swatchBoxes = [];
    this.swatchLabel.setText("");
    this.swatchName.setText("");
  }

  renderSwatches(selectedIndex){
    // renderiza 5 blocos centrados (selected no meio)
    this.clearSwatches();
    this.swatchLabel.setText("Cores:");

    const visible = 5;
    const half = Math.floor(visible/2);
    const start = selectedIndex - half;

    const baseX = 144;
    const baseY = 148;
    const gap = 24;

    for (let i=0;i<visible;i++){
      const idx = (start + i + COLOR_SWATCHES.length) % COLOR_SWATCHES.length;
      const sw = COLOR_SWATCHES[idx];

      const x = baseX + i*gap;
      const rect = this.add.rectangle(x, baseY, 18, 12, sw.value, 1).setOrigin(0,0);
      rect.setStrokeStyle(2, 0x000000, 0.45);

      const isSel = (idx === selectedIndex);
      if (isSel){
        rect.setStrokeStyle(2, 0xffdf7e, 0.95);
      } else {
        rect.setStrokeStyle(2, 0x92a6bd, 0.55);
      }

      this.swatchGroup.add(rect);
      this.swatchBoxes.push({ rect, idx });
    }

    this.swatchName.setText(COLOR_SWATCHES[selectedIndex].name);
  }

  refresh(){
    this.applyStateFromWizard();

    const k = this.steps[this.step];

    this.prompt.setText("");
    this.value.setText("");
    this.sub.setText("");
    this.clearSwatches();

    if (k==="nome"){
      this.prompt.setText("NOME");
      const show = (this.nameBuffer.length ? this.nameBuffer : "");
      this.value.setText(`${show}_`);
      this.sub.setText("Digite seu nome (BACKSPACE apaga). ENTER confirma.");
      return;
    }

    if (k==="sexo"){
      this.prompt.setText("SEXO");
      this.value.setText(this.sexIndex===0 ? "Masculino" : "Feminino");
      this.sub.setText("Use ←→ para alternar.");
      return;
    }

    if (k==="cabelo_tipo"){
      this.prompt.setText("TIPO DE CABELO");
      this.value.setText(HAIR_STYLES[this.hairStyleIndex].label);
      this.sub.setText("Use ←→ para escolher.");
      return;
    }

    if (k==="cabelo_cor"){
      this.prompt.setText("COR DO CABELO");
      this.value.setText(" ");
      this.sub.setText("Use ←→ para mudar.");
      this.renderSwatches(this.hairColorIndex);
      return;
    }

    if (k==="camiseta_cor"){
      this.prompt.setText("COR DA CAMISETA");
      this.value.setText(" ");
      this.sub.setText("Use ←→ para mudar.");
      this.renderSwatches(this.shirtColorIndex);
      return;
    }

    if (k==="calca_cor"){
      this.prompt.setText("COR DA CALÇA");
      this.value.setText(" ");
      this.sub.setText("Use ←→ para mudar.");
      this.renderSwatches(this.pantsColorIndex);
      return;
    }

    if (k==="calcado_cor"){
      this.prompt.setText("COR DO CALÇADO");
      this.value.setText(" ");
      this.sub.setText("Use ←→ para mudar.");
      this.renderSwatches(this.shoeColorIndex);
      return;
    }

    // continuar
    this.prompt.setText("PRONTO?");
    this.value.setText("▶ Continuar");
    this.sub.setText("ENTER para abrir confirmação.");
  }

  goStep(delta){
    this.step = clamp(this.step + delta, 0, this.steps.length-1);
    Audio.sfx("ui_move");
    this.refresh();
  }

  adjust(dir){
    const k = this.steps[this.step];
    Audio.sfx("ui_move");

    if (k==="sexo"){
      this.sexIndex = (this.sexIndex + dir + 2) % 2;
    } else if (k==="cabelo_tipo"){
      this.hairStyleIndex = (this.hairStyleIndex + dir + HAIR_STYLES.length) % HAIR_STYLES.length;
    } else if (k==="cabelo_cor"){
      this.hairColorIndex = (this.hairColorIndex + dir + COLOR_SWATCHES.length) % COLOR_SWATCHES.length;
    } else if (k==="camiseta_cor"){
      this.shirtColorIndex = (this.shirtColorIndex + dir + COLOR_SWATCHES.length) % COLOR_SWATCHES.length;
    } else if (k==="calca_cor"){
      this.pantsColorIndex = (this.pantsColorIndex + dir + COLOR_SWATCHES.length) % COLOR_SWATCHES.length;
    } else if (k==="calcado_cor"){
      this.shoeColorIndex = (this.shoeColorIndex + dir + COLOR_SWATCHES.length) % COLOR_SWATCHES.length;
    }

    this.refresh();
  }

  openConfirmModal(){
    Audio.sfx("spark");
    this.cameras.main.flash(200, 255, 255, 255);
    this.cameras.main.shake(220, 0.008);

    this.inModal = true;
    this.modalChoice = 0;
    this.modal.setVisible(true);
    this.updateModalText();
  }

  updateModalText(){
    const sim = (this.modalChoice===0) ? "▶ Sim" : "  Sim";
    const nao = (this.modalChoice===1) ? "▶ Não" : "  Não";
    this.modalText.setText(`${sim}      ${nao}`);
  }

  closeModal(){
    this.inModal = false;
    this.modal.setVisible(false);
  }

  confirmModal(){
    if (this.modalChoice===0){
      Audio.sfx("ui_ok");
      wipeToScene(this, "Overworld", {});
    } else {
      Audio.sfx("ui_back");
      this.closeModal();
      this.step = this.steps.length-1;
      this.refresh();
    }
  }

  update(){
    if (this.inModal){
      if (Phaser.Input.Keyboard.JustDown(this.keys.left) || Phaser.Input.Keyboard.JustDown(this.keys.right)){
        Audio.sfx("ui_move");
        this.modalChoice = 1 - this.modalChoice;
        this.updateModalText();
      }
      if (Phaser.Input.Keyboard.JustDown(this.keys.enter)) this.confirmModal();
      if (Phaser.Input.Keyboard.JustDown(this.keys.esc)){
        Audio.sfx("ui_back");
        this.closeModal();
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.up)) this.goStep(-1);
    if (Phaser.Input.Keyboard.JustDown(this.keys.down)) this.goStep(1);

    if (Phaser.Input.Keyboard.JustDown(this.keys.left)) this.adjust(-1);
    if (Phaser.Input.Keyboard.JustDown(this.keys.right)) this.adjust(1);

    if (Phaser.Input.Keyboard.JustDown(this.keys.enter)){
      const k = this.steps[this.step];
      if (k==="nome"){
        // confirma nome e avança
        Audio.sfx("ui_ok");
        this.goStep(1);
        return;
      }
      if (k==="continuar"){
        this.openConfirmModal();
        return;
      }
      Audio.sfx("ui_ok");
      this.goStep(1);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.esc)){
      Audio.sfx("ui_back");
      if (this.step === 0){
        wipeToScene(this, "Title", {});
      } else {
        this.goStep(-1);
      }
    }
  }
}

/* -----------------------------
   Overworld
   ----------------------------- */
class OverworldScene extends Phaser.Scene {
  constructor(){ super("Overworld"); }

  create(){
    Audio.playMusic("serene");
    ensurePlayerTextures(this);

    this.mapW = 24;
    this.mapH = 14;

    const map = [];
    for (let y=0;y<this.mapH;y++){
      const row = [];
      for (let x=0;x<this.mapW;x++){
        let t = 0;

        if (x===0||y===0||x===this.mapW-1||y===this.mapH-1) t = 6;
        if ((x===1||y===1||x===this.mapW-2||y===this.mapH-2) && chance(0.35)) t = 6;

        if (y===9 && x>=2 && x<=21) t = 1;
        if (x===12 && y>=4 && y<=12) t = 1;

        if ((x>=19 && x<=22) && (y>=2 && y<=6)) t = 3;

        if ((x>=3 && x<=8) && (y>=3 && y<=6)) t = 2;
        if ((x>=4 && x<=9) && (y>=10 && y<=12)) t = 2;

        if (t===0 && chance(0.08) && y>2 && x>2 && x<this.mapW-3 && y<this.mapH-3) t = 5;
        if (y===8 && x>=2 && x<=6) t = 4;

        row.push(t);
      }
      map.push(row);
    }
    this.map = map;

    this.baseLayer = this.add.container(0,0);
    this.decLayer = this.add.container(0,0);

    for (let y=0;y<this.mapH;y++){
      for (let x=0;x<this.mapW;x++){
        const t = this.map[y][x];
        const baseKey = (t===1) ? "tile_path" : (t===2) ? "tile_grass" : (t===3) ? "tile_water" : "tile_ground";
        this.baseLayer.add(this.add.image(x*TILE + TILE/2, y*TILE + TILE/2, baseKey).setOrigin(0.5));

        if (t===4) this.decLayer.add(this.add.image(x*TILE + TILE/2, y*TILE + TILE/2, "tile_fence").setOrigin(0.5));
        if (t===5) this.decLayer.add(this.add.image(x*TILE + TILE/2, y*TILE + TILE/2, "tile_flower").setOrigin(0.5));
        if (t===6) this.decLayer.add(this.add.image(x*TILE + TILE/2, y*TILE + TILE/2, "tile_tree").setOrigin(0.5));
      }
    }

    this.house = this.add.image(4*TILE + 8, 10*TILE + 4, "house_red").setOrigin(0.5, 1);
    this.shop1 = this.add.image(9*TILE + 8, 8*TILE + 4, "house_blue").setOrigin(0.5,1);
    this.shop2 = this.add.image(15*TILE + 8, 11*TILE + 4, "house_blue").setOrigin(0.5,1);
    this.shop3 = this.add.image(18*TILE + 8, 8*TILE + 4, "house_blue").setOrigin(0.5,1);

    const makeLabel = (x,y,text)=>{
      const bg = this.add.rectangle(x, y+1, Math.max(44, text.length*6), 12, 0x000000, 0.35).setOrigin(0.5);
      const t = this.add.text(x, y, text, { fontFamily:"monospace", fontSize:"8px", color:"#eef3f7" }).setOrigin(0.5);
      t.setStroke("#000000", 3);
      t.setShadow(1,1,"#000",2,false,true);
      bg.setDepth(t.depth-1);
      return t;
    };

    makeLabel(this.shop1.x, this.shop1.y+8, "SERRALH.");
    makeLabel(this.shop2.x, this.shop2.y+8, "DROGARIA");
    makeLabel(this.shop3.x, this.shop3.y+8, "BIQUEIRA");

    const city = this.add.text(12*TILE+8, 3*TILE+6, "DIADEMA", { fontFamily:"monospace", fontSize:"8px", color:"#ffdf7e" }).setOrigin(0.5);
    city.setStroke("#000000", 4);
    city.setShadow(1,1,"#000",2,false,true);

    this.npc = this.add.sprite(12*TILE + 8, 7*TILE + 8, "npc").setOrigin(0.5,1);

    this.player = this.add.sprite(
      6*TILE + 8, 11*TILE + 8,
      playerTexKey(state.sexo, state.hairStyle, state.hairColor, state.shirtColor, state.pantsColor, state.shoeColor, 0)
    ).setOrigin(0.5,1);
    this.player.gridX = 6;
    this.player.gridY = 11;
    this.player.moving = false;

    this.paper = this.add.tileSprite(0,0,W,H,"paper_noise").setOrigin(0,0).setAlpha(0.12).setScrollFactor(0).setDepth(999);
    this.paper.setBlendMode(Phaser.BlendModes.MULTIPLY);

    this.textBox = new TextBox(this);

    // HUD topo
    this.hud = this.add.container(0,0).setScrollFactor(0).setDepth(1500);
    const hudBg = this.add.rectangle(0,0,W,18,PALETTE.uiFill2,0.62).setOrigin(0,0);
    this.hudTxt = this.add.text(6,4,"", { fontFamily:"monospace", fontSize:"9px", color:"#eef3f7" });
    this.hudTxt.setShadow(1,1,"#000",2,false,true);
    this.hud.add([hudBg, this.hudTxt]);

    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER
    });

    this.steps = 0;
    this.encounterLock = false;

    if (!state.flags.ato1Done){
      this.playAct1();
    } else {
      this.updateHUD();
    }
  }

  updateHUD(){
    const s = state.stats;
    const prof = professionForLevel(state.level);
    this.hudTxt.setText(`${state.nome} • ${prof} • Nv${state.level}  XP ${state.xp}/${state.xpProx}  HP ${s.vida}/${s.vidaMax}  MP ${s.mana}/${s.manaMax}  R$${state.gold}`);
  }

  playAct1(){
    const lines = [
      { name:"Narrador", text:"Acorda lentamente... cabeça dói. Estômago ronca." },
      { name:"Narrador", text:"Cheiro de madeira velha e cobertor úmido." },
      { name:"Moradora", text:"Graças a Deus você acordou..." },
      { name:"Moradora", text:"Achamos você na entrada de Diadema." },
      { name:"Moradora", text:"Sexta-feira fria e chuvosa. Você tava perdido." },
      { name:"Morador", text:"Tava bem mal. Cheiro forte de álcool... chopp, talvez." },
      { name:"Morador", text:"Chorava e tinha acesso de raiva ao mesmo tempo..." },
      { name:"Morador", text:"Até que desmaiou. A gente te trouxe." },
      { name:"Moradora", text:"Sem documentos. Sem informação. Você não lembrava nem seu nome." },
      { name:"Moradora", text:"Descansa. Diadema não é rica... mas é nossa casa." },
      { name:"Narrador", text:"A ameaça inicial: sobrevivência." },
      { name:"Narrador", text:"(Você pode andar. ENTER interage.)" }
    ];
    this.textBox.start(lines, ()=>{
      state.flags.ato1Done = true;
      gainXP(this, 20);
      this.updateHUD();
    });
  }

  tileAt(x,y){
    if (x<0||y<0||x>=this.mapW||y>=this.mapH) return 6;
    return this.map[y][x];
  }

  isBlocked(x,y){
    const t = this.tileAt(x,y);
    if (t===3 || t===6) return true;

    const px = x*TILE + 8;
    const py = y*TILE + 8;
    const collides = (spr)=>{
      const b = spr.getBounds();
      return Phaser.Geom.Rectangle.Contains(b, px, py);
    };
    if (collides(this.house) || collides(this.shop1) || collides(this.shop2) || collides(this.shop3)) return true;
    return false;
  }

  tryMove(dx,dy){
    if (this.textBox.active || this.player.moving) return;
    const nx = this.player.gridX + dx;
    const ny = this.player.gridY + dy;
    if (this.isBlocked(nx, ny)) return;

    this.player.moving = true;
    this.player.gridX = nx;
    this.player.gridY = ny;

    const f = (this.steps % 2) ? 1 : 2;
    this.player.setTexture(playerTexKey(state.sexo, state.hairStyle, state.hairColor, state.shirtColor, state.pantsColor, state.shoeColor, f));
    Audio.sfx("step");

    this.tweens.add({
      targets: this.player,
      x: nx*TILE + 8,
      y: ny*TILE + 8,
      duration: 140,
      ease: "Linear",
      onComplete: ()=>{
        this.player.moving = false;
        this.player.setTexture(playerTexKey(state.sexo, state.hairStyle, state.hairColor, state.shirtColor, state.pantsColor, state.shoeColor, 0));
        this.steps++;
        this.updateHUD();

        const t = this.tileAt(nx,ny);
        if (t===2 && !this.encounterLock && chance(0.16)){
          this.encounterLock = true;
          Audio.sfx("encounter");
          this.cameras.main.flash(120, 255, 255, 255);
          this.time.delayedCall(140, ()=>{
            wipeToScene(this, "Battle", { from:"diadema" });
          });
        }
      }
    });
  }

  interact(){
    if (this.textBox.active) { this.textBox.advance(); return; }
    if (this.player.moving) return;

    Audio.sfx("ui_ok");

    const px = this.player.x;
    const py = this.player.y;
    const near = (obj, dist=22)=> Phaser.Math.Distance.Between(px,py,obj.x,obj.y) < dist;

    if (near(this.npc, 24)){
      const lines = [
        { name:"Morador", text:"Sobreviver aqui já é uma batalha." },
        { name:"Morador", text:"Trabalhar, pagar contas, lutar todo dia." }
      ];
      this.textBox.start(lines, ()=>{
        if (!state.flags.metNPC1){
          state.flags.metNPC1 = true;
          gainXP(this, 18);
        }
        this.updateHUD();
      });
      return;
    }

    if (near(this.shop1, 26)){
      this.textBox.start([
        { name:"Serralheiro", text:"Arma boa é suor e aço." },
        { name:"Serralheiro", text:"Volta quando tiver uns trocados." }
      ], ()=>{});
      return;
    }

    if (near(this.shop2, 26)){
      this.textBox.start([
        { name:"Drogaria", text:"Cura, mana, alívio temporário." },
        { name:"Drogaria", text:"Tudo tem seu preço." }
      ], ()=>{});
      return;
    }

    if (near(this.shop3, 26)){
      this.textBox.start([
        { name:"Biqueira", text:"Quer um boost?" },
        { name:"Biqueira", text:"Mas toda escolha cobra depois." }
      ], ()=>{});
      return;
    }

    if (near(this.house, 26)){
      this.textBox.start([
        { name:"Narrador", text:"Você volta à casa onde acordou..." },
        { name:"Narrador", text:"Você descansa um pouco." }
      ], ()=>{
        state.stats.vida = state.stats.vidaMax;
        state.stats.mana = state.stats.manaMax;
        Audio.sfx("heal");
        this.updateHUD();
      });
      return;
    }
  }

  update(time, delta){
    this.textBox.update(delta);

    if (!this.textBox.active){
      if (Phaser.Input.Keyboard.JustDown(this.keys.up)) this.tryMove(0,-1);
      else if (Phaser.Input.Keyboard.JustDown(this.keys.down)) this.tryMove(0,1);
      else if (Phaser.Input.Keyboard.JustDown(this.keys.left)) this.tryMove(-1,0);
      else if (Phaser.Input.Keyboard.JustDown(this.keys.right)) this.tryMove(1,0);
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.enter)){
      this.interact();
    }
  }
}

/* -----------------------------
   Battle (HUD alinhado)
   ----------------------------- */
class BattleScene extends Phaser.Scene {
  constructor(){ super("Battle"); }
  init(data){ this.from = data?.from || "diadema"; }

  create(){
    Audio.playMusic("battle");
    this.add.image(W/2, H/2, "battle_bg_forest").setOrigin(0.5);

    // fireflies
    this.fireflies = [];
    for (let i=0;i<14;i++){
      const dot = this.add.circle(rint(12,W-12), rint(12,120), 1, PALETTE.gold, 0.6).setDepth(5);
      dot._vx = (Math.random()*0.4+0.1) * (chance(0.5)?1:-1);
      dot._vy = (Math.random()*0.3+0.1) * (chance(0.5)?1:-1);
      dot._t = Math.random()*1000;
      this.fireflies.push(dot);
    }

    this.paper = this.add.tileSprite(0,0,W,H,"paper_noise").setOrigin(0,0).setAlpha(0.12).setScrollFactor(0).setDepth(1500);
    this.paper.setBlendMode(Phaser.BlendModes.MULTIPLY);

    const e = pickEnemy();
    this.enemy = {
      key: e.key,
      name: e.name,
      hpMax: e.hpBase + Math.floor(state.level*3.5),
      hp: e.hpBase + Math.floor(state.level*3.5),
      att: e.attBase + Math.floor(state.level*0.7),
      def: e.defBase + Math.floor(state.level*0.45),
      evd: e.evd,
      xp: e.xpBase + Math.floor(state.level*5),
      goldBase: e.goldBase
    };

    if (this.from === "diadema") applyDiademaNerf(this.enemy);

    this.enemySprite = this.add.sprite(W-92, 74, `${this.enemy.key}_0`).setOrigin(0.5).setDepth(20);

    ensurePlayerTextures(this);
    this.playerSprite = this.add.sprite(
      92, 158,
      playerTexKey(state.sexo, state.hairStyle, state.hairColor, state.shirtColor, state.pantsColor, state.shoeColor, 0)
    ).setOrigin(0.5, 1).setScale(2).setDepth(20);

    addInkBleed(this, this.enemySprite, PALETTE.ink2, 0.25);
    addInkBleed(this, this.playerSprite, PALETTE.ink2, 0.25);

    // motoboy: moto passando no fundo
    this.bike = null;
    if (this.enemy.key === "enemy_motoboy"){
      this.bike = this.add.image(-40, 86, "bike").setOrigin(0.5).setAlpha(0.55).setDepth(8);
      this.time.addEvent({
        delay: 1700, loop:true,
        callback: ()=>{
          if (!this.bike) return;
          this.bike.x = -40;
          this.tweens.add({ targets:this.bike, x:W+40, duration:1050, ease:"Linear" });
        }
      });
    }

    this.time.addEvent({ delay: 420, loop:true, callback: ()=>{
      const tex = this.enemySprite.texture.key.endsWith("_0") ? `${this.enemy.key}_1` : `${this.enemy.key}_0`;
      this.enemySprite.setTexture(tex);
      this.enemySprite.y += (chance(0.5)?1:-1);
      this.time.delayedCall(80, ()=> this.enemySprite.y -= (chance(0.5)?1:-1));
    }});

    this.add.text(SAFE_PAD, 10, "BATALHA", { fontFamily:"monospace", fontSize:"10px", color:"#ffdf7e" });

    // HUD ENEMY (top-right safe)
    this.enemyBox = this.add.image(W - SAFE_PAD - 148, 14, "ui_small").setOrigin(0,0).setDepth(1600);
    this.enemyName = this.add.text(W - SAFE_PAD - 140, 20, this.enemy.name, { fontFamily:"monospace", fontSize:"9px", color:"#eef3f7" }).setDepth(1700);
    this.enemyHPText = this.add.text(W - SAFE_PAD - 140, 32, "", { fontFamily:"monospace", fontSize:"9px", color:"#d8e0ea" }).setDepth(1700);

    // HUD PLAYER (top-left safe) — FIX alinhamento!
    const prof = professionForLevel(state.level);
    this.playerBox = this.add.image(SAFE_PAD, 50, "ui_small").setOrigin(0,0).setDepth(1600);
    this.playerName = this.add.text(SAFE_PAD+8, 56, `${state.nome} • ${prof} Nv${state.level}`, { fontFamily:"monospace", fontSize:"9px", color:"#eef3f7" }).setDepth(1700);
    this.playerHPText = this.add.text(SAFE_PAD+8, 68, "", { fontFamily:"monospace", fontSize:"9px", color:"#d8e0ea" }).setDepth(1700);
    this.playerMPText = this.add.text(SAFE_PAD+8, 80, "", { fontFamily:"monospace", fontSize:"9px", color:"#d8e0ea" }).setDepth(1700);

    [this.enemyName,this.enemyHPText,this.playerName,this.playerHPText,this.playerMPText].forEach(t=>{
      t.setShadow(1,1,"#000",2,false,true);
    });

    this.enemyHPBar = null;
    this.playerHPBar = null;

    this.textBox = new TextBox(this);

    // MENU (safe, acima do textbox)
    this.menuBox = this.add.image(W - SAFE_PAD - 170, H - 64 - 70, "ui_menu").setOrigin(0,0).setScrollFactor(0).setDepth(2100);
    this.menuText = this.add.text(W - SAFE_PAD - 162, H - 64 - 62, "", { fontFamily:"monospace", fontSize:"10px", color:"#eef3f7", lineSpacing:8 }).setScrollFactor(0).setDepth(2200);
    this.menuBox.setVisible(false);
    this.menuText.setVisible(false);

    this.menuMode = "root";
    this.cursor = 0;
    this.menuLocked = false;

    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER
    });

    this.updateHUD();

    this.textBox.start([{ name:"Narrador", text:`Um ${this.enemy.name} apareceu!` }], ()=>{
      this.showMenu();
    });
  }

  updateHUD(){
    const s = state.stats;
    this.enemyHPText.setText(`HP ${this.enemy.hp}/${this.enemy.hpMax}`);
    this.playerHPText.setText(`HP ${s.vida}/${s.vidaMax}`);
    this.playerMPText.setText(`MP ${s.mana}/${s.manaMax}`);

    if (this.enemyHPBar) this.enemyHPBar.destroy();
    if (this.playerHPBar) this.playerHPBar.destroy();

    // HP bars safe
    this.enemyHPBar = drawHPBar(this, W - SAFE_PAD - 140, 44, 124, 6, this.enemy.hp, this.enemy.hpMax, 1750);
    this.playerHPBar = drawHPBar(this, SAFE_PAD+8, 92, 124, 6, s.vida, s.vidaMax, 1750);
  }

  showMenu(){
    this.menuMode = "root";
    this.cursor = 0;
    this.menuBox.setVisible(true);
    this.menuText.setVisible(true);
    this.renderMenu();
  }

  hideMenu(){
    this.menuBox.setVisible(false);
    this.menuText.setVisible(false);
  }

  renderMenu(){
    if (this.textBox.active) return;

    const itemsRoot = ["FIGHT","MAGIC","RUN","STATUS"];
    const itemsFight = ["GOLPE","FOCO","VOLTAR",""];
    const itemsMagic = ["BOLT","BARRIER","VOLTAR",""];

    const items = (this.menuMode==="root") ? itemsRoot :
                  (this.menuMode==="fight") ? itemsFight : itemsMagic;

    const a = items.map((it,i)=>{
      const cur = (i===this.cursor) ? "▶" : " ";
      return `${cur} ${it}`;
    });

    const pad = 18;
    const L1 = (a[0]||"").padEnd(pad," ");
    const L2 = (a[2]||"").padEnd(pad," ");
    const R1 = (a[1]||"");
    const R2 = (a[3]||"");

    this.menuText.setText(`${L1}${R1}\n${L2}${R2}`);
  }

  moveCursor(dx,dy){
    Audio.sfx("ui_move");
    const col = (this.cursor % 2);
    const row = Math.floor(this.cursor / 2);
    const ncol = clamp(col + dx, 0, 1);
    const nrow = clamp(row + dy, 0, 1);
    this.cursor = nrow*2 + ncol;
    this.renderMenu();
  }

  select(){
    if (this.textBox.active) { this.textBox.advance(); return; }
    if (this.menuLocked) return;

    Audio.sfx("ui_ok");

    if (this.menuMode === "root"){
      if (this.cursor === 0){ this.menuMode="fight"; this.cursor=0; this.renderMenu(); return; }
      if (this.cursor === 1){ this.menuMode="magic"; this.cursor=0; this.renderMenu(); return; }

      if (this.cursor === 2){
        const pRun = runChance();
        this.menuLocked = true;
        this.hideMenu();
        this.textBox.start([{name:"", text:`Tentando fugir... (${Math.floor(pRun*100)}%)`}], ()=>{
          if (chance(pRun)){
            this.textBox.start([{name:"", text:"Você conseguiu fugir!"}], ()=>{
              Audio.playMusic("serene");
              wipeToScene(this, "Overworld", {});
            });
          } else {
            this.textBox.start([{name:"", text:"Não deu! O inimigo te cercou!"}], ()=>{
              this.enemyTurn(true);
            });
          }
        });
        return;
      }

      if (this.cursor === 3){
        const s = state.stats;
        const hit = Math.floor(hitChancePlayer()*100);
        const crit = Math.floor(critChance()*100);
        const evp = Math.floor(evadeChancePlayer()*100);
        const run = Math.floor(runChance()*100);

        this.menuLocked = true;
        this.hideMenu();
        this.textBox.start([{name:"Status", text:
          `FOR ${s.forca}  DEF ${s.defesa}  VIT ${s.vidaMax}\n`+
          `INT ${s.inteligencia}  DES ${s.destreza}  AGI ${s.agilidade}\n`+
          `SORTE ${s.sorte}  MP ${s.manaMax}\n\n`+
          `Chances: Acerto ${hit}%  Crítico ${crit}%\n`+
          `Esquiva ${evp}%  Fuga ${run}%`
        }], ()=>{
          this.menuLocked = false;
          this.showMenu();
        });
        return;
      }
    }

    if (this.menuMode === "fight"){
      if (this.cursor === 2){ this.menuMode="root"; this.cursor=0; Audio.sfx("ui_back"); this.renderMenu(); return; }

      if (this.cursor === 0){
        this.menuLocked = true;
        this.hideMenu();
        Audio.sfx("attack");
        this.playerHit("GOLPE", playerPhysical(this.enemy));
        return;
      }

      if (this.cursor === 1){
        this.menuLocked = true;
        this.hideMenu();
        const s = state.stats;
        s.destreza += 1;
        s.agilidade += 1;
        this.updateHUD();
        this.textBox.start([{name:"", text:"FOCO! Destreza e Agilidade ↑"}], ()=>{
          this.enemyTurn(true, ()=> {
            s.destreza -= 1;
            s.agilidade -= 1;
            this.updateHUD();
          });
        });
        return;
      }
    }

    if (this.menuMode === "magic"){
      if (this.cursor === 2){ this.menuMode="root"; this.cursor=0; Audio.sfx("ui_back"); this.renderMenu(); return; }

      const s = state.stats;

      if (this.cursor === 0){
        this.menuLocked = true;
        this.hideMenu();
        Audio.sfx("attack");
        this.playerHit("BOLT", playerMagic(this.enemy));
        return;
      }

      if (this.cursor === 1){
        const cost = 5;
        if (s.mana < cost){
          this.menuLocked = true;
          this.hideMenu();
          this.textBox.start([{name:"", text:"Mana insuficiente!"}], ()=>{
            this.menuLocked = false;
            this.showMenu();
          });
          return;
        }
        s.mana -= cost;
        s.defesa += 2;
        this.updateHUD();

        this.menuLocked = true;
        this.hideMenu();
        this.textBox.start([{name:"", text:"BARRIER! Defesa ↑"}], ()=>{
          this.enemyTurn(true, ()=>{
            s.defesa -= 2;
            this.updateHUD();
          });
        });
        return;
      }
    }
  }

  playerHit(label, res){
    const missOrEvade = ()=>{
      this.afterPlayerAttack();
    };

    if (res.fail){
      this.textBox.start([{name:"", text:res.msg}], ()=>{
        this.menuLocked = false;
        this.showMenu();
      });
      return;
    }
    if (res.miss){
      this.textBox.start([{name:"", text:`${label}... ERROU!`}], missOrEvade);
      return;
    }
    if (res.evaded){
      this.textBox.start([{name:"", text:`${label}... o inimigo ESQUIVOU!`}], missOrEvade);
      return;
    }

    const dmg = res.dmg;
    const crit = res.crit;

    this.textBox.start([{name:"", text: crit ? `${label}! CRÍTICO!` : `${label}!` }], ()=>{
      if (crit) Audio.sfx("crit");
      Audio.sfx("hit");
      this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
      this.updateHUD();
      this.enemySprite.x += 3;
      this.time.delayedCall(90, ()=>{ this.enemySprite.x -= 3; });
      this.afterPlayerAttack();
    });
  }

  afterPlayerAttack(){
    if (this.enemy.hp <= 0){
      this.textBox.start([{name:"", text:`${this.enemy.name} foi derrotado!`}], ()=>{
        Audio.sfx("win");
        const xpGain = this.enemy.xp;
        const goldGain = giveGoldForWin(this.enemy);

        this.textBox.start([{name:"", text:`Você ganhou ${xpGain} XP e R$${goldGain}!`}], ()=>{
          gainXP(this, xpGain);
          Audio.playMusic("serene");
          wipeToScene(this, "Overworld", {});
        });
      });
      return;
    }
    this.enemyTurn();
  }

  enemyTurn(skipMsg=false, after=()=>{}){
    const s = state.stats;
    const atk = enemyAttack(this.enemy);

    const doHit = ()=>{
      if (atk.evaded){
        this.textBox.start([{name:"", text:"Você esquivou!"}], ()=>{
          after();
          this.menuLocked = false;
          this.showMenu();
        });
        return;
      }
      Audio.sfx("hit");
      s.vida = Math.max(0, s.vida - atk.dmg);
      this.updateHUD();
      this.cameras.main.shake(80, 0.006);

      this.textBox.start([{name:"", text:`O inimigo atacou! (-${atk.dmg} HP)`}], ()=>{
        if (s.vida <= 0){
          this.textBox.start([{name:"", text:"Você desmaiou..."}], ()=>{
            Audio.sfx("lose");
            s.vida = s.vidaMax;
            s.mana = s.manaMax;
            Audio.playMusic("serene");
            wipeToScene(this, "Overworld", {});
          });
        } else {
          after();
          this.menuLocked = false;
          this.showMenu();
        }
      });
    };

    if (skipMsg){ doHit(); return; }
    this.textBox.start([{name:"", text:"O inimigo se moveu..." }], ()=> doHit());
  }

  update(time, delta){
    this.textBox.update(delta);

    for (const d of this.fireflies){
      d._t += delta;
      d.x += d._vx;
      d.y += d._vy;
      d.alpha = 0.35 + 0.25*Math.sin(d._t/220);
      if (d.x<8 || d.x>W-8) d._vx *= -1;
      if (d.y<8 || d.y>120) d._vy *= -1;
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.enter)){
      this.select();
      return;
    }
    if (this.textBox.active || this.menuLocked) return;

    if (Phaser.Input.Keyboard.JustDown(this.keys.left)) this.moveCursor(-1,0);
    if (Phaser.Input.Keyboard.JustDown(this.keys.right)) this.moveCursor(1,0);
    if (Phaser.Input.Keyboard.JustDown(this.keys.up)) this.moveCursor(0,-1);
    if (Phaser.Input.Keyboard.JustDown(this.keys.down)) this.moveCursor(0,1);
  }
}

/* -----------------------------
   LevelUp
   ----------------------------- */
class LevelUpScene extends Phaser.Scene {
  constructor(){ super("LevelUpScene"); }
  init(data){ this.resumeKey = data?.resumeKey || null; }

  create(){
    this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.62).setScrollFactor(0).setDepth(10);

    const panel = this.add.image(W/2, H/2, "ui_box_safe").setOrigin(0.5).setScrollFactor(0).setDepth(11);
    panel.setScale(1, 1.18);

    this.title = this.add.text(SAFE_PAD+6, 14, `LEVEL UP! Nv${state.level}`, { fontFamily:"monospace", fontSize:"10px", color:"#ffdf7e" }).setScrollFactor(0).setDepth(12);

    this.points = 3;
    this.cursor = 0;

    this.mode = (state.level >= 45 && !state.careerChoice) ? "career" : "stats";

    this.optionsStats = [
      { key:"forca", label:"Força +1" },
      { key:"defesa", label:"Defesa +1" },
      { key:"vidaMax", label:"Vida +5" },
      { key:"inteligencia", label:"Inteligência +1" },
      { key:"destreza", label:"Destreza +1" },
      { key:"agilidade", label:"Agilidade +1" },
      { key:"sorte", label:"Sorte +1" },
      { key:"done", label:"Sair" }
    ];

    this.optionsCareer = [
      { key:"presidente", label:"Presidente" },
      { key:"empreendedor", label:"Empreendedor" }
    ];

    this.list = this.add.text(SAFE_PAD+6, 34, "", { fontFamily:"monospace", fontSize:"10px", color:"#eef3f7", lineSpacing:6 }).setScrollFactor(0).setDepth(12);

    this.keys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER
    });

    Audio.sfx("ui_ok");
    this.refresh();
  }

  refresh(){
    const s = state.stats;
    const prof = professionForLevel(state.level);

    const header =
      `Profissão: ${prof}\n`+
      `Pontos: ${this.points}\n`+
      `HP ${s.vida}/${s.vidaMax}  MP ${s.mana}/${s.manaMax}\n`+
      `R$${state.gold}\n\n`;

    if (this.mode === "career"){
      const body = this.optionsCareer.map((o,i)=>{
        const cur = (i===this.cursor) ? "▶" : " ";
        return `${cur} ${o.label}`;
      }).join("\n");

      this.list.setText(header + "Escolha seu destino (45+):\n" + body);
      return;
    }

    const body = this.optionsStats.map((o,i)=>{
      const cur = (i===this.cursor) ? "▶" : " ";
      return `${cur} ${o.label}`;
    }).join("\n");

    this.list.setText(header + body);
  }

  applyOption(opt){
    const s = state.stats;

    if (this.mode === "career"){
      state.careerChoice = (opt.key === "presidente") ? "Presidente" : "Empreendedor";
      Audio.sfx("ui_ok");
      this.mode = "stats";
      this.cursor = 0;
      this.refresh();
      return;
    }

    if (opt.key === "done"){
      Audio.sfx("ui_back");
      this.close();
      return;
    }
    if (this.points <= 0){
      this.close();
      return;
    }

    Audio.sfx("ui_ok");

    if (opt.key === "vidaMax"){
      s.vidaMax += 5;
      s.vida = s.vidaMax;
    } else if (opt.key === "inteligencia"){
      s.inteligencia += 1;
      s.manaMax += 2;
      s.mana = s.manaMax;
    } else {
      s[opt.key] += 1;
    }

    s.vida = s.vidaMax;
    s.mana = s.manaMax;

    this.points--;
    this.refresh();

    if (this.points <= 0){
      this.time.delayedCall(160, ()=> this.close());
    }
  }

  close(){
    if (this.resumeKey){
      this.scene.resume(this.resumeKey);
    }
    this.scene.stop();
  }

  update(){
    const options = (this.mode === "career") ? this.optionsCareer : this.optionsStats;

    if (Phaser.Input.Keyboard.JustDown(this.keys.up)){
      Audio.sfx("ui_move");
      this.cursor = (this.cursor + options.length - 1) % options.length;
      this.refresh();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.down)){
      Audio.sfx("ui_move");
      this.cursor = (this.cursor + 1) % options.length;
      this.refresh();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.enter)){
      this.applyOption(options[this.cursor]);
    }
  }
}

/* =========================================================
   Phaser config
   ========================================================= */
const config = {
  type: Phaser.AUTO,
  width: W,
  height: H,
  pixelArt: true,
  backgroundColor: "#0c0f12",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    zoom: ZOOM
  },
  scene: [BootScene, TitleScene, CreateWizardScene, OverworldScene, BattleScene, LevelUpScene]
};

new Phaser.Game(config);
