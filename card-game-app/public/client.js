const socket = io();

let myId = null;
let currentRoomId = null;
let latestState = null;
let selectedCard = null; // 選択中の手札カード instanceId

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  ['title', 'lobby', 'game'].forEach((s) => {
    $('screen-' + s).classList.toggle('hidden', s !== name);
  });
}

// ---------- タイトル画面 ----------
$('btnCreateRoom').onclick = () => {
  const name = $('nameInput').value.trim();
  socket.emit('createRoom', { name }, (res) => {
    if (!res.ok) return ($('titleError').textContent = res.error || '作成に失敗しました');
    myId = res.playerId;
    currentRoomId = res.roomId;
    showScreen('lobby');
  });
};

$('btnJoinRoom').onclick = () => {
  $('joinBox').classList.toggle('hidden');
};

$('btnDoJoin').onclick = () => {
  const name = $('nameInput').value.trim();
  const roomId = $('roomIdInput').value.trim();
  socket.emit('joinRoom', { name, roomId }, (res) => {
    if (!res.ok) return ($('titleError').textContent = res.error || '参加に失敗しました');
    myId = res.playerId;
    currentRoomId = res.roomId;
    showScreen('lobby');
  });
};

// ---------- ロビー画面 ----------
$('btnLeaveLobby').onclick = () => {
  socket.emit('leaveRoom');
  showScreen('title');
};

$('btnApplySettings').onclick = () => {
  socket.emit('setGameSettings', {
    turnLimitEnabled: $('chkTurnLimit').checked,
    turnLimit: parseInt($('turnLimitNum').value, 10) || 20,
    chatEnabled: $('chkChat').checked,
    showEnemyLife: $('chkShowLife').checked,
    showEnemyMana: $('chkShowMana').checked,
  });
};

$('btnStartGame').onclick = () => socket.emit('startGame');

$('btnLobbyChatSend').onclick = () => sendChat('lobbyChatInput');

// ---------- ゲーム画面 ----------
$('btnSurrender').onclick = () => { if (confirm('降参しますか?')) socket.emit('surrender'); };
$('btnLeaveGame').onclick = () => { socket.emit('leaveRoom'); showScreen('title'); };
$('btnGameChatSend').onclick = () => sendChat('gameChatInput');

function sendChat(inputId) {
  const input = $(inputId);
  const text = input.value.trim();
  if (!text) return;
  const scope = $('chatTarget') ? $('chatTarget').value : 'all';
  socket.emit('chat', { scope, message: text });
  input.value = '';
}

// ---------- カード再生ポップアップ ----------
function openCardPopup(card) {
  selectedCard = card;
  $('popupCardName').textContent = `No.${card.no} ${card.name}`;
  $('popupCardCost').textContent = card.baseCost == null ? 'コスト:可変' : `コスト:${card.baseCost}`;
  $('popupCost').classList.toggle('hidden', card.no !== 7 && card.no !== 13);
  const targetSel = $('popupTarget');
  targetSel.innerHTML = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(対象なし/自分)';
  targetSel.appendChild(noneOpt);
  if (latestState) {
    for (const p of latestState.players) {
      if (!p.alive) continue;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.id === myId ? '(自分)' : '');
      targetSel.appendChild(opt);
    }
  }
  $('cardPopup').classList.remove('hidden');
}

$('btnCancelPlay').onclick = () => {
  $('cardPopup').classList.add('hidden');
  selectedCard = null;
};

$('btnPlayFaceDown').onclick = () => {
  if (!selectedCard) return;
  socket.emit('playCard', { instanceId: selectedCard.instanceId, faceUp: false });
  $('cardPopup').classList.add('hidden');
  selectedCard = null;
};

$('btnPlayFaceUp').onclick = () => {
  if (!selectedCard) return;
  const targetId = $('popupTarget').value || undefined;
  const chosenCost = parseInt($('popupCost').value, 10) || undefined;
  socket.emit('playCard', { instanceId: selectedCard.instanceId, faceUp: true, targetId, chosenCost });
  $('cardPopup').classList.add('hidden');
  selectedCard = null;
};

// ---------- サーバーからの状態更新 ----------
socket.on('state', (state) => {
  latestState = state;
  myId = state.you;

  if (!state.started) {
    renderLobby(state);
    if ($('screen-title').classList.contains('hidden') === false) {
      // まだタイトルにいる場合は何もしない(初回接続直後など)
    } else {
      showScreen('lobby');
    }
  } else {
    showScreen('game');
    renderGame(state);
  }
});

function renderLobby(state) {
  $('lobbyRoomId').textContent = state.roomId;
  $('hostControls').classList.toggle('hidden', state.hostId !== myId);
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.textContent = p.name + (p.id === state.hostId ? '(GM)' : '');
    list.appendChild(li);
  }
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
    box.className = 'oppBox' + (p.alive ? '' : ' dead');
    box.innerHTML = `<div>${p.name}${p.id === state.currentPlayerId ? ' ▶' : ''}${p.shielded ? ' 🛡' : ''}</div>
      <div>♡${p.life == null ? '?' : p.life} ★${p.mana == null ? '?' : p.mana}</div>
      <div>手札:${p.handCount}枚</div>
      <div>場: ${p.field.map((f) => f.faceUp ? `${f.name}${f.misfired ? '(不発)' : ''}` : '裏').join(', ') || 'なし'}</div>`;
    oppDiv.appendChild(box);
    if (box) {
      // 拡大表示は簡易的にalertで代用
      box.onclick = () => alert(`${p.name} の場:\n` + (p.field.map((f) => f.faceUp ? `${f.name}` : '裏向きカード').join('\n') || 'なし'));
    }
  }

  if (me) {
    $('selfName').textContent = me.name;
    $('selfLife').textContent = me.life;
    $('selfMana').textContent = me.mana;

    const fieldDiv = $('myField');
    fieldDiv.innerHTML = '';
    for (const f of me.field) {
      const c = document.createElement('div');
      c.className = 'fieldCard' + (f.faceUp ? '' : ' down');
      c.textContent = f.faceUp ? `${f.name}${f.misfired ? '(不発)' : ''}` : '裏向き';
      fieldDiv.appendChild(c);
    }

    const handDiv = $('myHand');
    handDiv.innerHTML = '';
    const isMyTurn = state.currentPlayerId === myId;
    for (const c of me.hand || []) {
      const div = document.createElement('div');
      div.className = 'handCard';
      div.textContent = `No.${c.no} ${c.name}`;
      if (isMyTurn) {
        div.onclick = () => {
          document.querySelectorAll('.handCard').forEach((el) => el.classList.remove('selected'));
          div.classList.add('selected');
          openCardPopup(c);
        };
      }
      handDiv.appendChild(div);
    }
  }

  // チャット宛先セレクト更新
  const sel = $('chatTarget');
  const prev = sel.value;
  sel.innerHTML = '<option value="all">全体</option>';
  for (const p of others) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = prev || 'all';

  if (state.ended) {
    const winner = state.players.find((p) => p.id === state.winnerId);
    appendLog(winner ? `ゲーム終了!勝者: ${winner.name}` : 'ゲーム終了(勝者なし)');
  }
}

socket.on('systemLog', (lines) => {
  for (const l of lines) appendLog(l);
});

function appendLog(text) {
  const div = $('gameLog');
  const line = document.createElement('div');
  line.textContent = text;
  div.appendChild(line);
  div.scrollTop = div.scrollHeight;
}

socket.on('chatMessage', (msg) => {
  const boxId = $('screen-game').classList.contains('hidden') ? 'lobbyChat' : 'gameChat';
  const box = $(boxId);
  const line = document.createElement('div');
  line.className = msg.scope;
  line.textContent = `${msg.from}: ${msg.text}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
});
