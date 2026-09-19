const socket = io();

let myId = null;
let latestState = null;
let selectedCard = null;

const $ = (id) => document.getElementById(id);

// ==== カード情報(表示用。効果ロジックはサーバー側 cards.js が正) ====
const CARD_INFO = {
  1: { name: '探索', cost: '1', black: false, effect: '山札からカードを1枚引き、自身の手札を1枚山札に戻す。' },
  2: { name: '治療', cost: '1', black: false, effect: '自身のライフを+3する(初期ライフを超えない)。' },
  3: { name: '強奪', cost: '2', black: true, effect: '相手を1人選び、マナを3盗む。' },
  4: { name: '攻撃', cost: '2', black: true, effect: '相手に3ダメージ、自身に1ダメージ。' },
  5: { name: '防御', cost: '2', black: false, effect: '次の自分のターンまで、他プレイヤーの能力を受けない。' },
  6: { name: '取引', cost: '3', black: false, effect: '相手プレイヤー1人と手札を交換する。' },
  7: { name: '賭博', cost: '1〜7(選択)', black: true, effect: '相手とルーレット対決。差分に応じてダメージ・マナ授受。' },
  8: { name: '戦争', cost: '4', black: true, effect: '相手と手札No.合計を比較。負けた方が差分ダメージ。' },
  9: { name: '輪廻', cost: '5', black: false, effect: 'ライフ・マナをリセットし、手札を全て入れ替える。' },
  10: { name: '反逆', cost: '3', black: false, effect: '次の自分のターンまで、受けた能力を反射する。' },
  11: { name: '深淵', cost: '6', black: false, effect: '黒いカードを2枚引き、即座に効果を発動する。' },
  12: { name: '浄化', cost: '使用済黒カード数×1.5', black: false, effect: '黒いカードの使用・保持数に応じて全体にダメージ・マナ減少。' },
  13: { name: '混沌', cost: '全マナ', black: true, effect: 'マナ量に応じた規模のランダムな全体効果が発動する。' },
  0: { name: 'シークレット', cost: '0', black: null, effect: '破滅または豪運のいずれかが発動する。' },
};

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

$('btnCredits').onclick = () => {
  alert('混沌\n制作: あなた自身とClaude\n(クレジット画面は準備中です)');
};

// ========== ロビー画面 ==========
$('btnLeaveLobby').onclick = () => { socket.emit('leaveRoom'); showScreen('title'); };
$('btnDisbandRoom').onclick = () => { if (confirm('ルームを解散しますか?')) { socket.emit('leaveRoom'); showScreen('title'); } };

$('btnShowRules').onclick = () => { $('ruleText').textContent = RULE_TEXT; openOverlay('ruleOverlay'); };
$('btnCloseRules').onclick = () => closeOverlay('ruleOverlay');

$('btnCardCount').onclick = () => { buildCardCountList(); openOverlay('cardCountOverlay'); };
$('btnCardCountCancel').onclick = () => closeOverlay('cardCountOverlay');
$('btnCardCountDefault').onclick = () => buildCardCountList(true);
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

const DEFAULT_COUNTS = { 1:4,2:4,3:4,4:4,5:3,6:3,7:3,8:3,9:2,10:2,11:1,12:1,13:1 };
function buildCardCountList(useDefault) {
  const list = $('cardCountList');
  list.innerHTML = '';
  for (let no = 1; no <= 13; no++) {
    const row = document.createElement('div');
    row.className = 'cardCountRow';
    const val = useDefault ? DEFAULT_COUNTS[no] : DEFAULT_COUNTS[no];
    row.innerHTML = `<span>No.${no} ${cardLabel(no)}</span><input type="number" min="0" max="10" value="${val}" data-no="${no}" />`;
    list.appendChild(row);
  }
}

$('btnGameSettings').onclick = () => openOverlay('gameSettingsOverlay');
$('btnGameSettingsCancel').onclick = () => closeOverlay('gameSettingsOverlay');
$('btnGameSettingsDefault').onclick = () => {
  $('chkTurnLimit').checked = false;
  $('turnLimitNum').value = 20;
  $('chkChat').checked = true;
  $('chkShowLife').checked = true;
  $('chkShowMana').checked = true;
};
$('btnApplySettings').onclick = () => {
  socket.emit('setGameSettings', {
    turnLimitEnabled: $('chkTurnLimit').checked,
    turnLimit: parseInt($('turnLimitNum').value, 10) || 20,
    chatEnabled: $('chkChat').checked,
    showEnemyLife: $('chkShowLife').checked,
    showEnemyMana: $('chkShowMana').checked,
  });
  closeOverlay('gameSettingsOverlay');
};

$('btnStartGame').onclick = () => socket.emit('startGame');
$('btnLobbyChatSend').onclick = () => sendChat('lobbyChatInput', 'lobbyChatTarget');

// ========== ゲーム画面 ==========
$('btnSurrender').onclick = () => { if (confirm('降参しますか?')) socket.emit('surrender'); };
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
function makeCardEl(card, opts = {}) {
  const div = document.createElement('div');
  const info = CARD_INFO[card.no] || {};
  div.className = 'card' + (info.black ? ' black' : '') + (card.faceUp === false ? ' down' : '') + (card.misfired ? ' misfired' : '');
  if (opts.extraClass) div.classList.add(opts.extraClass);
  if (card.faceUp === false && !opts.forceShow) {
    div.innerHTML = `<div class="cardNameSmall">裏</div>`;
  } else {
    div.innerHTML = `
      <div class="cardNo">No.${card.no}</div>
      <div class="cardCost">${info.cost || ''}</div>
      <div class="cardNameSmall">${info.name || card.name}${card.misfired ? '(不発)' : ''}</div>
    `;
  }
  return div;
}

// ========== カード選択ポップアップ ==========
function openCardPopup(card, handList) {
  selectedCard = card;
  renderPopupHandStrip(handList);
  renderPopupCard(card);
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

function renderPopupCard(card) {
  const info = CARD_INFO[card.no] || {};
  $('popupCardName').textContent = `No.${card.no} ${info.name || card.name}`;
  $('popupCardCost').textContent = info.cost || '-';
  $('popupCardEffect').textContent = info.effect || '';
  $('popupCost').classList.toggle('hidden', card.no !== 7 && card.no !== 13);

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
  socket.emit('playCard', { instanceId: selectedCard.instanceId, faceUp: true, targetId, chosenCost });
  closeOverlay('cardPopup');
  selectedCard = null;
};

// ========== サーバーからの状態更新 ==========
socket.on('state', (state) => {
  latestState = state;
  myId = state.you;

  if (!state.started) {
    renderLobby(state);
    if ($('screen-title').classList.contains('hidden')) showScreen('lobby');
  } else {
    showScreen('game');
    renderGame(state);
  }
});

function renderLobby(state) {
  $('lobbyRoomId').textContent = state.roomId;
  const isHost = state.hostId === myId;
  $('hostControls').classList.toggle('hidden', !isHost);
  $('btnStartGame').classList.toggle('hidden', !isHost);
  $('btnDisbandRoom').classList.toggle('hidden', !isHost);

  const list = $('playerList');
  list.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (p.id === state.hostId) li.classList.add('host');
    list.appendChild(li);
  }

  updateChatTargetSelect($('lobbyChatTarget'), state);
}

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
      <div class="oppName">${p.name}${p.shielded ? ' 🛡' : ''}</div>
      <div class="oppStats"><span class="lifeTag">♡${p.life == null ? '?' : p.life}</span><span class="manaTag">★${p.mana == null ? '?' : p.mana}</span></div>
      <div class="oppHandCount">手札:${p.handCount}枚</div>
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

    // ポップアップが開いていれば内容を最新化
    if (!$('cardPopup').classList.contains('hidden') && selectedCard) {
      const stillThere = hand.find((c) => c.instanceId === selectedCard.instanceId);
      if (stillThere) { renderPopupHandStrip(hand); renderPopupCard(stillThere); }
      else closeOverlay('cardPopup');
    }
  }

  updateChatTargetSelect($('chatTarget'), state);

  if (state.ended) {
    const winner = state.players.find((p) => p.id === state.winnerId);
    appendLog(winner ? `ゲーム終了!勝者: ${winner.name}` : 'ゲーム終了(勝者なし)');
  }
}

function openFieldZoom(p) {
  $('fieldZoomTitle').textContent = `${p.name} の場`;
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
   ・裏向き: ライフ+1。内容は自分だけがわかる
3. 次の人のターンへ

【マナ】
ターン開始時、現在マナ0〜5で+3、6〜10で+2、11〜14で+1、15以上は回復なし(保持は上限なし)。

【黒いカード】
No.3・4・7・8・13。攻撃的な効果が多い。

【シークレットカード】
No.は0として扱う。「破滅」「豪運」の2種、各1枚のみ封入。`;
