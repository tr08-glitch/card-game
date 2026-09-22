const socket = io();

let myId = null;
let latestState = null;
let selectedCard = null;

const $ = (id) => document.getElementById(id);

// ==== カード情報(表示用。効果ロジックはサーバー側 cards.js が正) ====
// 「クラシックカード」= 通常のNo.1〜13+シークレットの、クラシック/アルファ両モード共通の基本カード群
const CARD_INFO = {
  1: { name: '探索', cost: '1', black: false, effect: '山札から1枚引く。引いた後、山札に戻すカードを1枚選ぶ(戻す前はターンが終わらない)。' },
  2: { name: '治療', cost: '1', black: false, effect: '自身のライフ+3(初期ライフを超えない。既に初期ライフを超えている場合は減らない)。' },
  3: { name: '強奪', cost: '2', black: true, effect: '相手を1人選び、マナを3(相手の保有分が上限)奪う。相手が防御中なら効果なし。相手が反逆状態なら逆に自分がマナを奪われる。' },
  4: { name: '攻撃', cost: '2', black: true, effect: '相手に3ダメージ、自身に1ダメージ。相手が防御中なら無効、反逆状態ならダメージが自分に跳ね返る。' },
  5: { name: '防御', cost: '2', black: false, effect: '次の自分のターンまで、他プレイヤーからのダメージ・マナ減少などの効果を一切受けない(自分から見えるだけでなく、相手にも防御中と表示される)。' },
  6: { name: '取引', cost: '3', black: false, effect: '相手プレイヤー1人の手札を見て、相手のカード1枚と自分のカード1枚を選んで交換する。一度相手の手札を見たら、交換を完了するまでキャンセルはできない。' },
  7: { name: '賭博', cost: '1〜7(自分で選択)', black: true,
    effect: '相手を1人選んでルーレット対決。自分の出目は1〜10のランダム値+2(使用者特典)、相手の出目は1〜10のランダム値そのまま(どちらも合計10が上限)。出目の差の分だけ、負けた方が「差×コスト÷6(切り上げ)」ダメージを受け、さらに差の半分(切り上げ、かつ相手の保有マナが上限)のマナが勝者に移動する。出目が同じ場合は両者がコスト分のダメージを受け、マナのやり取りはなし。' },
  8: { name: '戦争', cost: '4', black: true, effect: '相手と手札のNo.合計を比較。負けた方が差分のダメージを受ける(シークレットカードはNo.0として扱う)。' },
  9: { name: '輪廻', cost: '5', black: false, effect: 'ライフを初期ライフに戻し(回復ではなくリセット)、マナを3にし、手札を全て山札に戻して同じ枚数だけ新しく引き直す。' },
  10: { name: '反逆', cost: '0(ただしマナ3未満だと不発)', black: false,
    effect: '場では本物の裏向きカードと全く同じ見た目・扱いになり、他プレイヤーにもログにも正体は分からない(不発時のみ通常カードと同様に公開される)。ライフ+1(初期ライフを超えてもよい、裏向きに出した状況に近づけるため)。次の自分のターンが来るまでの間、他プレイヤーから攻撃・強奪などの効果を受けると、その効果はそのまま相手へ跳ね返る(反射)。次の自分のターン開始時に自動で正体が公開され、マナを3消費する。' },
  11: { name: '深淵', cost: '6', black: true, effect: '山札の黒いカードを2枚引き、それぞれ即座に効果を発動する(黒いカードを引けなければその分は不発)。引いたカードも使用済みの黒いカードとして扱われる。' },
  12: { name: '浄化', cost: '自分が使用済みの黒いカード枚数×1.5(切り上げ)', black: false,
    effect: '全プレイヤーに対して、各自が「これまでに使用した黒いカードの枚数×2」分のダメージを与え、さらに各自の「現在手札にある黒いカードの枚数×2」分のマナを減少させる。使えば使うほど自分自身も巻き込まれる、自業自得型の全体カード。' },
  13: { name: '混沌', cost: '全マナ', black: true,
    effect: '消費したマナ量に応じて規模(小・中・大)が決まり、その規模の中からランダムに1つの全体効果が発動する。ごく低確率(2%)で規模を問わず「魘(えん)」が発動し、全員の行動が3ターンの間ランダムになる。全体攻撃系の効果は使用者へのダメージが1軽減される。効果の詳細は下の表を参照。' },
  0: { name: 'シークレット', cost: '0', black: null, effect: '破滅または豪運のいずれかが発動する。' },
};

const SECRET_INFO = {
  destruction: { name: '破滅', cost: '0', black: true, effect: '全プレイヤーのHPを1、マナを0にする。' },
  luck: { name: '豪運', cost: '0', black: false, effect: 'HP+5、マナ+3。山札から好きなカードを1枚選び手札1枚と交換。さらに次の自分のターン開始まで防御状態になる(他プレイヤーの能力を受けない)。' },
};

// アルファモード専用のカード
const ALPHA_CARD_INFO = {
  blessing: { name: '加護', cost: '-', effect: 'メリット:初期ライフ+5。自分のターンの終わりにライフ+1(初期ライフを超えない)。デメリット:なし。' },
  toughness: { name: '強靭', cost: '-', effect: '初期ライフ+7。受けるダメージを最終的に-1する。' },
  training: { name: '鍛錬', cost: '-', effect: '自分の場の裏向きカード1.5枚につき、与えるダメージが最終的に+1(例:裏向き2枚で+1)。初期ライフ+3。' },
  magicSword: { name: '魔剣', cost: '-', effect: '与えるダメージ+3。プレイヤーにダメージを与えると反動で自分が1ダメージを受ける(1回のカード使用につき反動は1回のみ)。' },
  wings: { name: '翼', cost: '-', effect: '手札の上限が1枚増える(ゲーム開始時から常に3枚。輪廻などで引き直した後も3枚になる)。その代わり、すべてのカードの最終コストが+1になる。' },
  muscle: { name: '筋肉', cost: '-', effect: '与えるダメージ+2、受けるダメージ-2、初期ライフ+7。その代わり手札の上限が1枚減る(常に1枚)。' },
  berserk: { name: '狂化', cost: '-', effect: '初期ライフ+13、与えるダメージ+2。その代わりライフが一切回復しなくなる(輪廻による初期ライフへのリセットは回復扱いではないため可能)。' },
  corruption: { name: '堕落', cost: '-', effect: '使った黒いカード2枚につき与ダメージ+1。黒いカードを使うとライフ+2(この回復は初期ライフを超えられる)。裏向きに置いた時、または黒いカード以外を使った時はライフ-1。' },
  apostle: { name: '使徒', cost: '-', effect: '初期ライフ+3。専用カード「神罰」が使えるようになる。黒いカードを使うとライフ-4。' },
  curse: { name: '呪詛', cost: '-', effect: '初期ライフ+3。自分のターンの終わりに、ランダムな敵1人へ固定2ダメージ、さらに別のランダムな敵1人へ固定1ダメージ(どちらも補正を受けない)。その代わり受けるダメージ+1。' },
  gambler: { name: '賭酔', cost: '-', effect: '自分のターンの初めに自動で「博打」の効果が発動する:全員でルーレットを回し(自分の出目には+2のボーナス)、各自「自分の出目-全員の平均値」分だけマナが増減する(合計は必ず0になる再分配。マナがマイナスになることもある)。加えて、ルーレットを使うカード全般(賭博など)で自分の出目に常に+1。その代わりマナが自然回復しなくなる。' },
};

const EXCLUSIVE_CARD_INFO = {
  divinePunishment: { name: '神罰', cost: 4, effect: '敵プレイヤー1人に 3+(相手が使った黒いカード2枚につき1) のダメージを与える。使徒でのみ使用可。' },
};

function renderExclusiveCardSlot(me, isMyTurn) {
  const slot = $('exclusiveCardSlot');
  slot.innerHTML = '';
  const owned = (me.alphaCards || []).filter((ac) => ac.exclusiveCard);
  for (const ac of owned) {
    const key = ac.exclusiveCard;
    const info = EXCLUSIVE_CARD_INFO[key];
    if (!info) continue;
    const btn = document.createElement('div');
    const canUse = isMyTurn && me.mana >= info.cost;
    btn.className = 'exclusiveCardBtn' + (canUse ? '' : ' disabled');
    btn.innerHTML = `<div>${info.name}</div><div class="excCost">コスト${info.cost}</div>`;
    if (canUse) {
      btn.onclick = () => {
        if (key === 'divinePunishment') {
          openExclusiveTargetOverlay(key);
        } else {
          if (confirm(`「${info.name}」を使いますか?`)) {
            socket.emit('playExclusiveCard', { exclusiveKey: key });
          }
        }
      };
    }
    slot.appendChild(btn);
  }
}

function openExclusiveTargetOverlay(exclusiveKey) {
  const list = $('exclusiveTargetList');
  list.innerHTML = '';
  const others = (latestState ? latestState.players : []).filter((p) => p.id !== myId && p.alive);
  for (const p of others) {
    const btn = document.createElement('button');
    btn.className = 'trialCandidateBtn';
    btn.textContent = p.name;
    btn.onclick = () => {
      socket.emit('playExclusiveCard', { exclusiveKey, targetId: p.id });
      closeOverlay('exclusiveTargetOverlay');
    };
    list.appendChild(btn);
  }
  openOverlay('exclusiveTargetOverlay');
}
$('btnExclusiveTargetCancel').onclick = () => closeOverlay('exclusiveTargetOverlay');

const SHORT_COST = { 1:'1',2:'1',3:'2',4:'2',5:'2',6:'3',7:'?',8:'4',9:'5',10:'3',11:'6',12:'?',13:'全',0:'0' };

function cardLabel(no) {
  const info = CARD_INFO[no] || {};
  return info.name || `No.${no}`;
}

function showScreen(name) {
  ['title', 'lobby', 'game'].forEach((s) => {
    $('screen-' + s).classList.toggle('hidden', s !== name);
  });
}

function openOverlay(id) { $(id).classList.remove('hidden'); }
function closeOverlay(id) { $(id).classList.add('hidden'); }

// ========== タイトル画面 ==========
$('btnTitleMenuRules').onclick = () => { $('ruleText').textContent = RULE_TEXT; openOverlay('ruleOverlay'); };
$('btnTitleMenuCardList').onclick = () => { buildCardListOverlay(); openOverlay('cardListOverlay'); };

$('btnCreateRoom').onclick = () => {
  const name = $('nameInput').value.trim();
  socket.emit('createRoom', { name }, (res) => {
    if (!res.ok) return ($('titleError').textContent = res.error || '作成に失敗しました');
    myId = res.playerId;
    showScreen('lobby');
  });
};

$('btnAiBattle').onclick = () => openOverlay('aiOverlay');
$('btnCloseAi').onclick = () => closeOverlay('aiOverlay');
$('aiDifficulty').oninput = (e) => { $('aiDifficultyLabel').textContent = e.target.value; };
$('btnStartAi').onclick = () => alert('AI対戦は現在準備中です。まずは友達とルームで対戦してみてください。');

$('btnJoinRoom').onclick = () => {
  buildKeypad();
  $('roomIdInput').value = '';
  openOverlay('joinOverlay');
};
$('btnCloseJoin').onclick = () => closeOverlay('joinOverlay');
$('btnClearRoomId').onclick = () => { $('roomIdInput').value = ''; };

function buildKeypad() {
  const pad = $('keypad');
  pad.innerHTML = '';
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  for (const k of keys) {
    const b = document.createElement('button');
    b.textContent = k;
    if (!k) { b.style.visibility = 'hidden'; }
    else {
      b.onclick = () => {
        const input = $('roomIdInput');
        if (k === '⌫') input.value = input.value.slice(0, -1);
        else if (input.value.length < 4) input.value += k;
      };
    }
    pad.appendChild(b);
  }
}

$('btnDoJoin').onclick = () => {
  const name = $('nameInput').value.trim();
  const roomId = $('roomIdInput').value.trim();
  socket.emit('joinRoom', { name, roomId }, (res) => {
    if (!res.ok) return ($('titleError').textContent = res.error || '参加に失敗しました');
    myId = res.playerId;
    closeOverlay('joinOverlay');
    showScreen('lobby');
  });
};

$('btnSettingsIcon').onclick = () => openOverlay('titleSettingsOverlay');
$('btnCloseTitleSettings').onclick = () => closeOverlay('titleSettingsOverlay');
$('btnTitleRules').onclick = () => { $('ruleText').textContent = RULE_TEXT; openOverlay('ruleOverlay'); };

$('btnLobbySettingsIcon').onclick = () => openOverlay('titleSettingsOverlay');

$('btnCredits').onclick = () => {
  alert('混沌\n制作: あなた自身とClaude\n(クレジット画面は準備中です)');
};

// ========== ロビー画面 ==========
$('btnLeaveLobby').onclick = () => { socket.emit('leaveRoom'); showScreen('title'); };
$('btnDisbandRoom').onclick = () => { if (confirm('ルームを解散しますか?')) { socket.emit('leaveRoom'); showScreen('title'); } };

$('btnShowRules').onclick = () => { $('ruleText').textContent = RULE_TEXT; openOverlay('ruleOverlay'); };
$('btnCloseRules').onclick = () => closeOverlay('ruleOverlay');
$('btnCloseCardList').onclick = () => closeOverlay('cardListOverlay');
$('btnTitleCardList').onclick = () => { buildCardListOverlay(); openOverlay('cardListOverlay'); };
$('btnLobbyCardList').onclick = () => { buildCardListOverlay(); openOverlay('cardListOverlay'); };
$('btnGameCardList').onclick = () => { buildCardListOverlay(); openOverlay('cardListOverlay'); };

function buildCardListOverlay() {
  const body = $('cardListBody');
  body.innerHTML = '';
  const classicHeader = document.createElement('div');
  classicHeader.className = 'cardListSectionHeader';
  classicHeader.textContent = 'クラシックカード(クラシック・アルファ両モード共通)';
  body.appendChild(classicHeader);
  for (let no = 1; no <= 13; no++) {
    const info = CARD_INFO[no];
    body.appendChild(makeCardListRow(`images/${no}.png`, `No.${no} ${info.name}`, info.cost, info.black, info.effect));
  }
  for (const key of ['destruction', 'luck']) {
    const info = SECRET_INFO[key];
    body.appendChild(makeCardListRow(`images/${key}.png`, `シークレット ${info.name}`, info.cost, info.black, info.effect));
  }
  body.appendChild(buildChaosTable());
  const alphaKeys = Object.keys(ALPHA_CARD_INFO);
  if (alphaKeys.length > 0) {
    const header = document.createElement('div');
    header.className = 'cardListSectionHeader';
    header.textContent = 'アルファカード(アルファモード専用)';
    body.appendChild(header);
    for (const key of alphaKeys) {
      const info = ALPHA_CARD_INFO[key];
      body.appendChild(makeCardListRow(info.image || `images/alpha_${key}.png`, info.name, info.cost || '-', false, info.effect));
    }
    const header2 = document.createElement('div');
    header2.className = 'cardListSectionHeader';
    header2.textContent = '専用カード(対応するアルファカードの所持者のみ使用可)';
    body.appendChild(header2);
    for (const key of Object.keys(EXCLUSIVE_CARD_INFO)) {
      const info = EXCLUSIVE_CARD_INFO[key];
      body.appendChild(makeCardListRow(`images/alpha_${key}.png`, info.name, info.cost, false, info.effect));
    }
  }
}

function buildChaosTable() {
  const wrap = document.createElement('div');
  wrap.className = 'chaosTableWrap';

  const title = document.createElement('div');
  title.className = 'cardListSectionHeader';
  title.textContent = 'No.13 混沌:規模ごとの効果一覧';
  wrap.appendChild(title);

  const rows = [
    ['規模', '発生条件(消費マナ)', '効果名', '内容'],
    ['小規模', '1〜5', 'つむじ風', '全プレイヤーのマナ-2、ライフ-3(使用者のみ-2)'],
    ['小規模', '1〜5', '落石', 'ランダムな対象に2ダメージ×4回'],
    ['小規模', '1〜5', '混乱', '全プレイヤー間で手札が入れ替わる'],
    ['小規模', '1〜5', '裁判(3人以上のみ)', '全員が1人に投票(使用者は2票)。最多得票者が7ダメージ(同数なら均等分割・切り上げ)'],
    ['中規模', '6〜10', '竜巻', '全プレイヤーのマナ-3、ライフ-5(使用者のみ-4)、さらにランダムな1人に追加3ダメージ'],
    ['中規模', '6〜10', '隕石', 'ランダムな対象に4ダメージ×4回'],
    ['中規模', '6〜10', '命水', '全プレイヤーのライフ+5(上限なし、初期ライフを超えてよい)'],
    ['中規模', '6〜10', '疫病', '1/3×人数×ルーレット(1〜10)のダメージを全体に(使用者は-1)'],
    ['大規模', '11以上', 'テンペスト', '全員のライフが1〜3のランダムな値になる(減少方向のみ)'],
    ['大規模', '11以上', 'スターレイン', 'ランダムな対象に1〜3ダメージ×10回'],
    ['大規模', '11以上', 'アノマリー', '黒いカードが出現しやすくなる。全員の手札上限が1〜4枚のいずれかにランダムに決まり引き直し、7-(手札枚数)分ライフ回復'],
    ['大規模', '11以上', 'ラグナロク', '各自に12-(自身の場の裏向きカード枚数)ダメージ'],
    ['規模不問', '低確率(2%)', '魘(えん)', '全プレイヤーが3ターンの間、行動(表裏・カード・対象・コスト)が全てランダムになる'],
  ];

  const table = document.createElement('table');
  table.className = 'chaosTable';
  rows.forEach((cols, i) => {
    const tr = document.createElement('tr');
    for (const col of cols) {
      const cell = document.createElement(i === 0 ? 'th' : 'td');
      cell.textContent = col;
      tr.appendChild(cell);
    }
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  return wrap;
}

function makeCardListRow(imgPath, title, cost, black, effect) {
  const row = document.createElement('div');
  row.className = 'cardListRow';
  const thumb = document.createElement('div');
  thumb.className = 'cardListThumb';
  thumb.style.backgroundImage = `url('${imgPath}')`;
  const infoDiv = document.createElement('div');
  infoDiv.className = 'cardListInfo';
  infoDiv.innerHTML = `<span class="cardListName${black ? ' black' : ''}">${title}</span><span class="cardListCost">コスト:${cost}</span><div class="cardListEffect">${effect}</div>`;
  row.appendChild(thumb);
  row.appendChild(infoDiv);
  return row;
}

$('btnCardCount').onclick = () => { buildCardCountList('current'); setCardCountEditable(true); openOverlay('cardCountOverlay'); };
$('btnCardCountView').onclick = () => { buildCardCountList('current'); setCardCountEditable(false); openOverlay('cardCountOverlay'); };
$('btnCardCountCancel').onclick = () => closeOverlay('cardCountOverlay');
$('btnCardCountClose').onclick = () => closeOverlay('cardCountOverlay');
$('btnCardCountDefault').onclick = () => buildCardCountList('default');
$('btnCardCountConfirm').onclick = () => {
  const counts = {};
  document.querySelectorAll('.cardCountRow input[type="number"]').forEach((inp) => {
    counts[inp.dataset.no] = parseInt(inp.value, 10) || 0;
  });
  counts.destruction = $('chkSecretCards').checked ? 1 : 0;
  counts.luck = $('chkSecretCards').checked ? 1 : 0;
  socket.emit('setCardCounts', counts);
  closeOverlay('cardCountOverlay');
};

function setCardCountEditable(editable) {
  document.querySelectorAll('#cardCountList input[type="number"]').forEach((inp) => { inp.disabled = !editable; });
  $('chkSecretCards').disabled = !editable;
  $('btnCardCountCancel').classList.toggle('hidden', !editable);
  $('btnCardCountDefault').classList.toggle('hidden', !editable);
  $('btnCardCountConfirm').classList.toggle('hidden', !editable);
  $('btnCardCountClose').classList.toggle('hidden', editable);
}

const DEFAULT_COUNTS = { 1:4,2:4,3:4,4:4,5:3,6:3,7:3,8:3,9:2,10:2,11:1,12:1,13:1 };
function buildCardCountList(mode) {
  const list = $('cardCountList');
  list.innerHTML = '';
  const current = (latestState && latestState.cardCounts) || {};
  for (let no = 1; no <= 13; no++) {
    const row = document.createElement('div');
    row.className = 'cardCountRow';
    const val = mode === 'default' ? DEFAULT_COUNTS[no] : (current[no] != null ? current[no] : DEFAULT_COUNTS[no]);
    row.innerHTML = `<span>No.${no} ${cardLabel(no)}</span><input type="number" min="0" max="10" value="${val}" data-no="${no}" />`;
    list.appendChild(row);
  }
  const secretsOff = current.destruction === 0 && current.luck === 0;
  $('chkSecretCards').checked = mode === 'default' ? true : !secretsOff;
}

$('btnGameSettings').onclick = () => { populateGameSettingsFields(); setGameSettingsEditable(true); syncTurnLimitFieldState(); syncAlphaVisibilityRow(); openOverlay('gameSettingsOverlay'); };
$('btnGameSettingsView').onclick = () => { populateGameSettingsFields(); setGameSettingsEditable(false); syncAlphaVisibilityRow(); openOverlay('gameSettingsOverlay'); };
$('chkTurnLimit').onchange = syncTurnLimitFieldState;
$('selGameMode').onchange = syncAlphaVisibilityRow;
function syncTurnLimitFieldState() {
  $('turnLimitNum').disabled = !$('chkTurnLimit').checked;
}
function syncAlphaVisibilityRow() {
  const isAlpha = $('selGameMode').value === 'alpha';
  $('rowAlphaVisibility').classList.toggle('hidden', !isAlpha);
}
function populateGameSettingsFields() {
  const s = (latestState && latestState.settings) || {};
  $('selGameMode').value = s.mode === 'alpha' ? 'alpha' : 'classic';
  $('initialLifeNum').value = s.initialLife != null ? s.initialLife : 10;
  $('chkTurnLimit').checked = !!s.turnLimitEnabled;
  $('turnLimitNum').value = s.turnLimit != null ? s.turnLimit : 20;
  $('chkChat').checked = s.chatEnabled !== false;
  $('chkShowLife').checked = s.showEnemyLife !== false;
  $('chkShowMana').checked = s.showEnemyMana !== false;
  $('chkShowHandCount').checked = s.showEnemyHandCount !== false;
  $('chkAlphaVisibility').checked = s.alphaCardVisibility !== false;
  syncTurnLimitFieldState();
  syncAlphaVisibilityRow();
}
function setGameSettingsEditable(editable) {
  ['selGameMode', 'initialLifeNum', 'chkTurnLimit', 'turnLimitNum', 'chkChat', 'chkShowLife', 'chkShowMana', 'chkShowHandCount', 'chkAlphaVisibility'].forEach((id) => { $(id).disabled = !editable; });
  if (!editable) $('turnLimitNum').disabled = true;
  $('btnGameSettingsCancel').classList.toggle('hidden', !editable);
  $('btnGameSettingsDefault').classList.toggle('hidden', !editable);
  $('btnApplySettings').classList.toggle('hidden', !editable);
  $('btnGameSettingsClose').classList.toggle('hidden', editable);
}
$('btnGameSettingsCancel').onclick = () => closeOverlay('gameSettingsOverlay');
$('btnGameSettingsClose').onclick = () => closeOverlay('gameSettingsOverlay');
$('btnGameSettingsDefault').onclick = () => {
  $('selGameMode').value = 'classic';
  $('initialLifeNum').value = 10;
  $('chkTurnLimit').checked = false;
  $('turnLimitNum').value = 20;
  $('chkChat').checked = true;
  $('chkShowLife').checked = true;
  $('chkShowMana').checked = true;
  $('chkShowHandCount').checked = true;
  $('chkAlphaVisibility').checked = true;
  syncTurnLimitFieldState();
  syncAlphaVisibilityRow();
};
$('btnApplySettings').onclick = () => {
  socket.emit('setGameSettings', {
    mode: $('selGameMode').value === 'alpha' ? 'alpha' : 'classic',
    initialLife: parseInt($('initialLifeNum').value, 10) || 10,
    turnLimitEnabled: $('chkTurnLimit').checked,
    turnLimit: parseInt($('turnLimitNum').value, 10) || 20,
    chatEnabled: $('chkChat').checked,
    showEnemyLife: $('chkShowLife').checked,
    showEnemyMana: $('chkShowMana').checked,
    showEnemyHandCount: $('chkShowHandCount').checked,
    alphaCardVisibility: $('chkAlphaVisibility').checked,
  });
  closeOverlay('gameSettingsOverlay');
};

$('btnStartGame').onclick = () => socket.emit('startGame');
$('btnReturnToLobby').onclick = () => socket.emit('returnToLobby');
$('btnNewGame').onclick = () => socket.emit('newGame');
$('btnLobbyChatSend').onclick = () => sendChat('lobbyChatInput', 'lobbyChatTarget');

socket.on('errorMsg', (msg) => { alert(msg); });

// ========== ゲーム画面 ==========
$('btnGameRules').onclick = () => { $('ruleText').textContent = RULE_TEXT; openOverlay('ruleOverlay'); };
$('btnSurrender').onclick = () => {
  if (latestState && latestState.ended) return;
  if (confirm('降参しますか?')) socket.emit('surrender');
};
$('btnLeaveGame').onclick = () => { socket.emit('leaveRoom'); showScreen('title'); };
$('btnGameChatSend').onclick = () => sendChat('gameChatInput', 'chatTarget');

$('btnToggleChat').onclick = () => {
  const panel = $('chatPanel');
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  $('btnToggleChat').textContent = willOpen ? '×' : '表示';
};

$('btnCloseFieldZoom').onclick = () => closeOverlay('fieldZoomOverlay');

function sendChat(inputId, targetSelectId) {
  const input = $(inputId);
  const text = input.value.trim();
  if (!text) return;
  const scope = $(targetSelectId) ? $(targetSelectId).value : 'all';
  socket.emit('chat', { scope, message: text });
  input.value = '';
}

// ========== カード表示ヘルパー ==========
function cardImagePath(card) {
  const key = card.secretKey || card.no;
  return `images/${key}.png`;
}

function makeCardEl(card, opts = {}) {
  const div = document.createElement('div');
  const info = CARD_INFO[card.no] || {};
  div.className = 'card' + (info.black ? ' black' : '') + (card.faceUp === false ? ' down' : '') + (card.misfired ? ' misfired' : '');
  if (opts.extraClass) div.classList.add(opts.extraClass);
  if (card.faceUp === false && !opts.forceShow) {
    div.innerHTML = `<div class="cardNameSmall">裏</div>`;
  } else {
    div.style.backgroundImage = `linear-gradient(rgba(20,10,35,0.55), rgba(20,10,35,0.75)), url('${cardImagePath(card)}')`;
    div.style.backgroundSize = 'cover';
    div.style.backgroundPosition = 'center';
    div.innerHTML = `
      <div class="cardNo${info.black ? ' blackCardNo' : ''}">No.${card.no}</div>
      <div class="cardCost">${SHORT_COST[card.no] != null ? SHORT_COST[card.no] : ''}</div>
      <div class="cardNameSmall">${info.name || card.name}${card.misfired ? '(不発)' : ''}</div>
    `;
  }
  return div;
}

// ========== カード選択ポップアップ ==========
function openCardPopup(card, handList) {
  selectedCard = card;
  renderPopupHandStrip(handList);
  renderPopupCard(card, handList);
  openOverlay('cardPopup');
}

function renderPopupHandStrip(handList) {
  const strip = $('popupHandStrip');
  strip.innerHTML = '';
  for (const c of handList) {
    const el = makeCardEl(c, { forceShow: true });
    el.classList.add('handCard');
    if (selectedCard && c.instanceId === selectedCard.instanceId) el.classList.add('selected');
    el.onclick = () => openCardPopup(c, handList);
    strip.appendChild(el);
  }
}

function renderPopupCard(card, handList) {
  const info = CARD_INFO[card.no] || {};
  $('popupCardName').textContent = `No.${card.no} ${info.name || card.name}`;
  $('popupCardCost').textContent = info.cost || '-';
  $('popupCardEffect').textContent = info.effect || '';
  // コストをプレイヤーが選べるのはNo.7のみ(No.13混沌は常に全マナを消費するため選択不要)
  $('popupCost').classList.toggle('hidden', card.no !== 7);

  const img = $('popupCardIllustImg');
  const fallback = $('popupCardIllustFallback');
  img.onerror = () => { img.classList.add('hidden'); fallback.classList.remove('hidden'); };
  img.onload = () => { img.classList.remove('hidden'); fallback.classList.add('hidden'); };
  img.classList.add('hidden');
  fallback.classList.remove('hidden');
  img.src = cardImagePath(card);

  const targetSel = $('popupTarget');
  targetSel.innerHTML = '<option value="">(対象なし/自分)</option>';
  if (latestState) {
    for (const p of latestState.players) {
      if (!p.alive) continue;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.id === myId ? '(自分)' : '');
      targetSel.appendChild(opt);
    }
    // 攻撃・妨害系カードは、誤って自分を対象にしてしまう事故を防ぐため
    // デフォルトの選択をランダムな相手プレイヤーにしておく(自分に使いたい場合は選び直せる)
    const ATTACK_TARGET_CARDS = new Set([3, 4, 6, 7, 8, 11]);
    if (ATTACK_TARGET_CARDS.has(card.no)) {
      const others = latestState.players.filter((p) => p.alive && p.id !== myId);
      if (others.length > 0) {
        const picked = others[Math.floor(Math.random() * others.length)];
        targetSel.value = picked.id;
      }
    }
  }
}

$('btnCancelPlay').onclick = () => { closeOverlay('cardPopup'); selectedCard = null; };

$('btnPlayFaceDown').onclick = () => {
  if (!selectedCard) return;
  socket.emit('playCard', { instanceId: selectedCard.instanceId, faceUp: false });
  closeOverlay('cardPopup');
  selectedCard = null;
};

$('btnPlayFaceUp').onclick = () => {
  if (!selectedCard) return;
  const targetId = $('popupTarget').value || undefined;
  const chosenCost = parseInt($('popupCost').value, 10) || undefined;

  if (selectedCard.no === 6) {
    if (!targetId) { alert('対象のプレイヤーを選んでください'); return; }
    startTradeFlow(selectedCard, targetId);
    closeOverlay('cardPopup');
    return;
  }

  socket.emit('playCard', { instanceId: selectedCard.instanceId, faceUp: true, targetId, chosenCost });
  closeOverlay('cardPopup');
  selectedCard = null;
};

// ========== 取引(No.6): 相手の手札を見て1枚ずつ交換 ==========
let tradeState = null; // { card, targetId, chosenGiveId, chosenTakeId }

function startTradeFlow(card, targetId) {
  tradeState = { card, targetId, chosenGiveId: null, chosenTakeId: null };
  socket.emit('peekHand', { targetId });
}

socket.on('handPeek', ({ targetId, hand }) => {
  if (!tradeState || tradeState.targetId !== targetId) return;
  renderTradeOverlay(hand);
  openOverlay('tradeOverlay');
});

function renderTradeOverlay(targetHand) {
  const targetDiv = $('tradeTargetHand');
  targetDiv.innerHTML = '';
  for (const c of targetHand) {
    const el = makeCardEl(c, { forceShow: true });
    el.classList.add('handCard');
    if (tradeState.chosenTakeId === c.instanceId) el.classList.add('selected');
    el.onclick = () => { tradeState.chosenTakeId = c.instanceId; renderTradeOverlay(targetHand); };
    targetDiv.appendChild(el);
  }

  const ownDiv = $('tradeOwnHand');
  ownDiv.innerHTML = '';
  const me = latestState && latestState.players.find((p) => p.id === myId);
  const ownHand = (me && me.hand) || [];
  for (const c of ownHand) {
    if (c.instanceId === tradeState.card.instanceId) continue; // 取引カード自体は交換対象にしない
    const el = makeCardEl(c, { forceShow: true });
    el.classList.add('handCard');
    if (tradeState.chosenGiveId === c.instanceId) el.classList.add('selected');
    el.onclick = () => { tradeState.chosenGiveId = c.instanceId; renderTradeOverlay(targetHand); };
    ownDiv.appendChild(el);
  }
}

// 取引は相手の手札を見た後のキャンセルを許可しない(情報だけ見て逃げる行為を防止するため)
$('btnTradeConfirm').onclick = () => {
  if (!tradeState || !tradeState.chosenGiveId || !tradeState.chosenTakeId) {
    alert('渡すカードともらうカードを、それぞれ1枚ずつ選んでください');
    return;
  }
  socket.emit('playCard', {
    instanceId: tradeState.card.instanceId,
    faceUp: true,
    targetId: tradeState.targetId,
    tradeGiveInstanceId: tradeState.chosenGiveId,
    tradeTakeInstanceId: tradeState.chosenTakeId,
  });
  tradeState = null;
  closeOverlay('tradeOverlay');
};

// ========== ルーレット演出(No.7 賭博) ==========
socket.on('rouletteResult', (data) => {
  rouletteAnimating = true;
  $('rouletteActorName').textContent = data.actorName;
  $('rouletteTargetName').textContent = data.targetName;
  const actorNumEl = $('rouletteActorNumber');
  const targetNumEl = $('rouletteTargetNumber');
  actorNumEl.textContent = '?';
  targetNumEl.textContent = '?';
  actorNumEl.classList.add('spinning');
  targetNumEl.classList.add('spinning');
  actorNumEl.classList.remove('landed');
  targetNumEl.classList.remove('landed');
  openOverlay('rouletteOverlay');

  const spinInterval = setInterval(() => {
    actorNumEl.textContent = String(1 + Math.floor(Math.random() * 10));
    targetNumEl.textContent = String(1 + Math.floor(Math.random() * 10));
  }, 80);

  setTimeout(() => {
    clearInterval(spinInterval);
    actorNumEl.textContent = String(data.actorRoll);
    targetNumEl.textContent = String(data.targetRoll);
    actorNumEl.classList.remove('spinning');
    targetNumEl.classList.remove('spinning');
    actorNumEl.classList.add('landed');
    targetNumEl.classList.add('landed');
  }, 1200);

  setTimeout(() => {
    closeOverlay('rouletteOverlay');
    rouletteAnimating = false;
    if (pendingStateDuringRoulette) {
      const s = pendingStateDuringRoulette;
      pendingStateDuringRoulette = null;
      applyState(s);
    }
  }, 3200);
});

// ========== 博打: 全員ルーレット演出 ==========
socket.on('gambleRouletteResult', (data) => {
  rouletteAnimating = true;
  const wrap = $('gambleRouletteWheels');
  wrap.innerHTML = '';
  const numEls = {};
  for (const p of data.players) {
    const side = document.createElement('div');
    side.className = 'rouletteSide';
    side.innerHTML = `
      <div class="rouletteName">${p.name}${p.id === data.actorId ? '(使用者)' : ''}</div>
      <div class="rouletteNumber spinning" id="gambleNum_${p.id}">?</div>
      <div class="rouletteDelta" id="gambleDelta_${p.id}"></div>
    `;
    wrap.appendChild(side);
    numEls[p.id] = side.querySelector(`#gambleNum_${p.id}`);
  }
  openOverlay('gambleRouletteOverlay');

  const spinInterval = setInterval(() => {
    for (const p of data.players) {
      numEls[p.id].textContent = String(1 + Math.floor(Math.random() * 10));
    }
  }, 80);

  setTimeout(() => {
    clearInterval(spinInterval);
    for (const p of data.players) {
      numEls[p.id].textContent = String(p.roll);
      numEls[p.id].classList.remove('spinning');
      numEls[p.id].classList.add('landed');
      const deltaEl = document.getElementById(`gambleDelta_${p.id}`);
      if (deltaEl) {
        if (p.delta > 0) { deltaEl.textContent = `マナ +${p.delta}`; deltaEl.classList.add('plus'); }
        else if (p.delta < 0) { deltaEl.textContent = `マナ ${p.delta}`; deltaEl.classList.add('minus'); }
        else { deltaEl.textContent = 'マナ ±0'; }
      }
    }
  }, 1200);

  setTimeout(() => {
    closeOverlay('gambleRouletteOverlay');
    rouletteAnimating = false;
    if (pendingStateDuringRoulette) {
      const s = pendingStateDuringRoulette;
      pendingStateDuringRoulette = null;
      applyState(s);
    }
  }, 3200);
});

// ========== 探索(No.1): 引いた後に戻すカードを選ぶ ==========
socket.on('searchReturnPrompt', ({ hand }) => {
  renderSearchReturnHand(hand);
  openOverlay('searchReturnOverlay');
});

function renderSearchReturnHand(hand) {
  const div = $('searchReturnHand');
  div.innerHTML = '';
  for (const c of hand) {
    const el = makeCardEl(c, { forceShow: true });
    el.classList.add('handCard');
    el.onclick = () => {
      socket.emit('searchReturn', { returnInstanceId: c.instanceId });
      closeOverlay('searchReturnOverlay');
    };
    div.appendChild(el);
  }
}

// ========== 裁判(混沌の小規模効果): 投票画面 ==========
let trialVoted = false;
socket.on('trialStart', ({ candidates, actingName }) => {
  trialVoted = false;
  $('trialDesc').textContent = `${actingName} の混沌により裁判が発動。1人を選んで投票してください(発動者の票は2票分)`;
  $('trialVoteStatus').textContent = '';
  renderTrialCandidates(candidates);
  openOverlay('trialOverlay');
});

function renderTrialCandidates(candidates) {
  const div = $('trialCandidates');
  div.innerHTML = '';
  for (const c of candidates) {
    const btn = document.createElement('button');
    btn.className = 'trialCandidateBtn';
    btn.innerHTML = `<div class="trialCandidateName">${c.name}</div><div class="trialCandidateStats">♡${c.life} ★${c.mana}</div>`;
    btn.onclick = () => {
      if (trialVoted) return;
      trialVoted = true;
      socket.emit('castTrialVote', { targetId: c.id });
      document.querySelectorAll('.trialCandidateBtn').forEach((b) => { b.disabled = true; });
      btn.classList.add('voted');
      $('trialVoteStatus').textContent = '投票しました。他のプレイヤーの投票を待っています…';
    };
    div.appendChild(btn);
  }
}

socket.on('trialVoteUpdate', ({ votedCount, totalVoters }) => {
  if (!$('trialOverlay').classList.contains('hidden')) {
    $('trialVoteStatus').textContent = `${votedCount}/${totalVoters}人が投票しました`;
  }
});

socket.on('trialEnd', () => {
  closeOverlay('trialOverlay');
});

// ========== アルファモード: ゲーム開始前のアルファカード選択 ==========
socket.on('alphaCardChoice', ({ candidates }) => {
  const list = $('alphaChoiceList');
  list.innerHTML = '';
  for (const c of candidates) {
    const btn = document.createElement('button');
    btn.className = 'trialCandidateBtn';
    btn.innerHTML = `<div class="trialCandidateName">${c.name}</div>`;
    btn.onclick = () => {
      socket.emit('pickAlphaCard', { key: c.key });
      closeOverlay('alphaChoiceOverlay');
    };
    list.appendChild(btn);
  }
  openOverlay('alphaChoiceOverlay');
});

// ========== 対戦画面の背景(参加人数に応じて自動切り替え) ==========
let currentBgPlayerCount = null;
const bgResolveCache = {};

function setTableBackground(n) {
  if (currentBgPlayerCount === n) return;
  currentBgPlayerCount = n;
  if (bgResolveCache[n]) {
    applyTableBackground(bgResolveCache[n]);
    return;
  }
  const candidates = [];
  for (let d = 0; d <= 4; d++) {
    if (n + d <= 6) candidates.push(n + d);
    if (d > 0 && n - d >= 2) candidates.push(n - d);
  }
  tryLoadCandidates(candidates, 0, n);
}

function tryLoadCandidates(list, i, n) {
  if (i >= list.length) return; // どれも読み込めない場合は既定の背景のまま
  const path = `images/table-${list[i]}.jpg`;
  const img = new Image();
  img.onload = () => { bgResolveCache[n] = path; if (currentBgPlayerCount === n) applyTableBackground(path); };
  img.onerror = () => tryLoadCandidates(list, i + 1, n);
  img.src = path;
}

function applyTableBackground(path) {
  $('screen-game').style.background =
    `linear-gradient(rgba(18,8,28,0.55), rgba(18,8,28,0.75)), url('${path}') center/cover no-repeat, radial-gradient(ellipse at 50% 0%, #2a1746 0%, #12081c 65%)`;
}

// ========== サーバーからの状態更新 ==========
let prevAliveState = true;
let endHandledForRoom = false;
let wasStarted = false;
let prevEnded = false;

let rouletteAnimating = false;
let pendingStateDuringRoulette = null;

socket.on('state', (state) => {
  if (rouletteAnimating) { pendingStateDuringRoulette = state; return; }
  applyState(state);
});

function applyState(state) {
  const startedFresh = (state.started && !wasStarted) || (prevEnded && !state.ended && state.started);
  wasStarted = state.started;
  prevEnded = state.ended;
  if (startedFresh) {
    prevAliveState = true;
    endHandledForRoom = false;
    $('victoryOverlay').classList.add('hidden');
    $('loseOverlay').classList.add('hidden');
    $('gameLog').innerHTML = ''; // 前回の試合のゲームログをクリア
  }
  if (!state.started) {
    $('victoryOverlay').classList.add('hidden');
    $('loseOverlay').classList.add('hidden');
  }

  latestState = state;
  myId = state.you;

  if (!state.started) {
    renderLobby(state);
    if ($('screen-title').classList.contains('hidden')) showScreen('lobby');
  } else {
    showScreen('game');
    renderGame(state);
  }
}

function renderLobby(state) {
  $('lobbyRoomId').textContent = state.roomId;
  const isHost = state.hostId === myId;
  $('hostControls').classList.toggle('hidden', !isHost);
  $('participantControls').classList.toggle('hidden', isHost);
  $('btnStartGame').classList.toggle('hidden', !isHost);
  $('btnDisbandRoom').classList.toggle('hidden', !isHost);

  const enoughPlayers = state.players.length >= 2;
  $('btnStartGame').disabled = !enoughPlayers;
  $('startGameHint').classList.toggle('hidden', !isHost || enoughPlayers);

  const list = $('playerList');
  list.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (p.id === state.hostId) li.classList.add('host');
    if (isHost && p.id !== myId) {
      li.classList.add('clickablePlayer');
      li.onclick = () => openPlayerActionOverlay(p.id, p.name);
    }
    list.appendChild(li);
  }

  updateChatTargetSelect($('lobbyChatTarget'), state);
}

// ========== プレイヤー操作(ゲームマスター専用) ==========
let playerActionTargetId = null;
function openPlayerActionOverlay(targetId, targetName) {
  playerActionTargetId = targetId;
  $('playerActionName').textContent = targetName;
  openOverlay('playerActionOverlay');
}
$('btnPlayerActionCancel').onclick = () => { playerActionTargetId = null; closeOverlay('playerActionOverlay'); };
$('btnMakeHost').onclick = () => {
  if (!playerActionTargetId) return;
  socket.emit('makeHost', { targetId: playerActionTargetId });
  playerActionTargetId = null;
  closeOverlay('playerActionOverlay');
};
$('btnKickPlayer').onclick = () => {
  if (!playerActionTargetId) return;
  if (!confirm('このプレイヤーを退室させますか?(このルームが解散されるまで再参加できなくなります)')) return;
  socket.emit('kickPlayer', { targetId: playerActionTargetId });
  playerActionTargetId = null;
  closeOverlay('playerActionOverlay');
};
socket.on('kicked', () => {
  alert('ゲームマスターによってルームから退室させられました');
  showScreen('title');
});

function updateChatTargetSelect(sel, state) {
  const prev = sel.value;
  sel.innerHTML = '<option value="all">全体</option>';
  for (const p of state.players) {
    if (p.id === myId) continue;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = prev || 'all';
}

function renderGame(state) {
  setTableBackground(state.players.length);
  $('deckCount').textContent = state.deckCount;
  $('turnInfo').textContent = state.turnLimitEnabled ? `${state.turnCount}/${state.turnLimit}` : '∞';

  const me = state.players.find((p) => p.id === myId);
  const others = state.players.filter((p) => p.id !== myId);

  const oppDiv = $('opponents');
  oppDiv.innerHTML = '';
  for (const p of others) {
    const box = document.createElement('div');
    box.className = 'oppBox' + (p.alive ? '' : ' dead') + (p.id === state.currentPlayerId ? ' currentTurn' : '');
    box.innerHTML = `
      <div class="oppLifeManaTag"><span class="lifeTag">♡${p.life == null ? '?' : p.life}</span> <span class="manaTag">★${p.mana == null ? '?' : p.mana}</span></div>
      <div class="oppAvatar">${p.shielded ? '🛡' : '🙂'}</div>
      <div class="oppName">${p.name}</div>
      <div class="oppHandCount">手札:${p.handCount == null ? '?' : p.handCount}枚</div>
      <div class="oppFieldMini">場:${p.field.length}枚</div>
    `;
    if (p.alive) {
      box.onclick = () => openFieldZoom(p);
    }
    oppDiv.appendChild(box);
  }

  if (me) {
    $('selfName').textContent = me.name;
    $('selfLife').textContent = me.life;
    $('selfMana').textContent = me.mana;
    $('selfInfo').onclick = () => openFieldZoom(me);

    const fieldDiv = $('myField');
    fieldDiv.innerHTML = '';
    for (const f of me.field) fieldDiv.appendChild(makeCardEl(f));

    const isMyTurn = state.currentPlayerId === myId && me.alive;
    const hand = me.hand || [];

    // 自分のターンに引いた手札は、最後にドローされたカード = 手札が3枚のときの最後の1枚として扱う簡易表示
    $('drawnCardArea').classList.toggle('hidden', !isMyTurn);
    if (isMyTurn && hand.length > 0) {
      const drawnDiv = $('drawnCard');
      drawnDiv.innerHTML = '';
      drawnDiv.appendChild(makeCardEl(hand[hand.length - 1], { forceShow: true }));
    }

    const handDiv = $('myHand');
    handDiv.innerHTML = '';
    for (const c of hand) {
      const el = makeCardEl(c, { forceShow: true });
      el.classList.add('handCard');
      if (!isMyTurn) el.classList.add('disabled');
      else el.onclick = () => openCardPopup(c, hand);
      handDiv.appendChild(el);
    }
    renderExclusiveCardSlot(me, isMyTurn);

    // ポップアップが開いていれば内容を最新化
    if (!$('cardPopup').classList.contains('hidden') && selectedCard) {
      const stillThere = hand.find((c) => c.instanceId === selectedCard.instanceId);
      if (stillThere) { renderPopupHandStrip(hand); renderPopupCard(stillThere, hand); }
      else closeOverlay('cardPopup');
    }
  }

  if (me) {
    if (prevAliveState === true && me.alive === false) {
      showLoseOverlay();
    }
    prevAliveState = me.alive;
  }

  if (state.ended && !endHandledForRoom) {
    endHandledForRoom = true;
    if (state.winnerId === myId) {
      showVictoryOverlay();
    } else if (!(me && me.alive === false)) {
      // 山札切れ等でライフ勝負に敗れた場合(死亡演出が出ていない場合)もLOSEを出す
      showLoseOverlay();
    }
  }

  $('btnSurrender').disabled = !!state.ended;
  $('btnReturnToLobby').classList.toggle('hidden', !(state.ended && state.hostId === myId));
  $('btnNewGame').classList.toggle('hidden', !(state.ended && state.hostId === myId));

  updateChatTargetSelect($('chatTarget'), state);

  if (state.ended) {
    const winner = state.players.find((p) => p.id === state.winnerId);
    appendLog(winner ? `ゲーム終了!勝者: ${winner.name}` : 'ゲーム終了(勝者なし)');
  }
}

function showLoseOverlay() {
  const el = $('loseOverlay');
  el.classList.remove('hidden');
  setTimeout(() => { el.classList.add('hidden'); }, 5000);
}

function showVictoryOverlay() {
  const el = $('victoryOverlay');
  el.classList.remove('hidden');
  setTimeout(() => { el.classList.add('hidden'); }, 5000);
}

function openFieldZoom(p) {
  $('fieldZoomTitle').textContent = `${p.name} の場`;
  const alphaDiv = $('fieldZoomAlphaCards');
  alphaDiv.innerHTML = '';
  if (p.alphaCards && p.alphaCards.length > 0) {
    for (const ac of p.alphaCards) {
      const tag = document.createElement('div');
      tag.className = 'alphaCardTag';
      tag.textContent = `★${ac.name}`;
      alphaDiv.appendChild(tag);
    }
  } else if (p.alphaCards) {
    alphaDiv.innerHTML = '<div class="alphaCardTag none">アルファカードなし</div>';
  }
  const cardsDiv = $('fieldZoomCards');
  cardsDiv.innerHTML = '';
  if (p.field.length === 0) {
    cardsDiv.textContent = 'なし';
  } else {
    for (const f of p.field) cardsDiv.appendChild(makeCardEl(f));
  }
  openOverlay('fieldZoomOverlay');
}

socket.on('systemLog', (lines) => { for (const l of lines) appendLog(l); });

function appendLog(text) {
  const div = $('gameLog');
  const line = document.createElement('div');
  line.textContent = text;
  div.appendChild(line);
  div.scrollTop = div.scrollHeight;
}

socket.on('chatMessage', (msg) => {
  const inGame = !$('screen-game').classList.contains('hidden');
  const box = inGame ? $('gameChat') : $('lobbyChat');
  const line = document.createElement('div');
  line.className = msg.scope;
  line.textContent = `${msg.from}: ${msg.text}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
});

const RULE_TEXT = `【基本ルール】
・2〜6人対戦。初期ライフ10、初期マナ0。
・ライフが0になったら観戦に回る。最後の生存者、または山札切れ時にライフ最大の人が勝利。

【ターンの流れ】
1. 山札から1枚引く
2. 手札から1枚を選び、自分の場に表向き/裏向きで出す(強制)
   ・表向き: コストを払い能力を発動(マナ不足なら不発。カード内容は全員に公開)
   ・裏向き: ライフ+1(初期ライフを超えてもよい)。内容は自分だけがわかる
3. 次の人のターンへ

【マナ】
ターン開始時、現在マナ0〜5で+3、6〜10で+2、11〜14で+1、15以上は回復なし(保持は上限なし)。マナがマイナスの場合は特別に固定+4回復する。

【黒いカード】
No.3・4・7・8・11・13。攻撃的・ダーク系の効果が多い。場や手札では、黒いカードのNo.が赤い文字で表示されるので一目で見分けられる。

【シークレットカード】
No.は0として扱う。「破滅」「豪運」の2種、各1枚のみ封入。

【複雑なカードについて】
反逆・賭博・浄化・混沌など、仕組みが込み入っているカードについては、タイトル画面や対戦画面の「カード一覧」に詳しい説明があります。迷ったらそちらを確認してください。

【アルファモード】
ゲーム設定の「モード」で「アルファ」を選ぶと、通常のカード(クラシック)に加えて「アルファカード」を使った対戦になる。
・ゲーム開始時、各プレイヤーに2枚のアルファカード候補が提示され、その中から1枚を選んで持った状態でスタートする。
・アルファカードはプレイヤーに常時バフ(強化効果)を与える。中には代償(デメリット)を伴うものもある。
・アルファカードは手札とは別に、そのプレイヤーに紐づいた状態で戦闘中ずっと保持される(手札のように毎ターン出し引きするものではない)。
・プレイヤーを撃破すると、倒した側はその撃破したプレイヤーが持っていたアルファカードを手に入れることができる。
・自分や相手のアイコンをタップすると、そのプレイヤーが持つアルファカードを確認できる。ただし「アルファカードの可視化」設定がオフの場合、他プレイヤーのアルファカードは見えない(自分のものは常に確認できる)。
・「アルファカードの可視化」はゲーム設定内、モードが「アルファ」の時のみ選択できる。`;
