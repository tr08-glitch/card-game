const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  buildDeck,
  shuffle,
  manaRegenAmount,
  resolveEffect,
  resolveTrialVotes,
  alivePlayers,
  dealDamage,
  ALPHA_CARDS,
  EXCLUSIVE_CARD_INFO,
  alphaSum,
  hasExclusive,
  applyLifeDelta,
  resolveDivinePunishment,
  resolveGamble,
} = require('./cards');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

// roomId(4桁文字列) -> room state
const rooms = {};

const DEFAULT_INITIAL_LIFE = 10;

function makeRoomId() {
  let id;
  do {
    id = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms[id]);
  return id;
}

function createRoom(hostSocketId, hostName) {
  const roomId = makeRoomId();
  const playerId = hostSocketId;
  const room = {
    roomId,
    hostId: playerId,
    players: {
      [playerId]: newPlayer(playerId, hostName),
    },
    order: [playerId],
    turnIndex: 0,
    deck: [],
    settings: {
      mode: 'classic', // 'classic' | 'alpha'
      turnLimitEnabled: false,
      turnLimit: 20,
      chatEnabled: true,
      showEnemyLife: true,
      showEnemyMana: true,
      initialLife: DEFAULT_INITIAL_LIFE,
      alphaCardVisibility: true, // アルファモード時のみ意味を持つ
    },
    cardCounts: {}, // 空なら cards.js のデフォルトを使う
    blackCardUsage: {}, // playerId -> 累計使用黒いカード枚数
    chatLog: [],
    started: false,
    ended: false,
    winnerId: null,
    turnCount: 0,
    bannedIds: new Set(), // 退室させられたプレイヤーのsocket.id(このルームが解散されるまで再参加不可)
    pendingSearchReturn: null, // 探索: 戻すカードの選択待ちのプレイヤーid
    pendingTrial: null, // 裁判: 投票待ちの情報 { actingId, candidateIds, votes }
  };
  rooms[roomId] = room;
  return room;
}

function newPlayer(id, name) {
  return {
    id,
    name: (name || 'プレイヤー').slice(0, 15),
    life: DEFAULT_INITIAL_LIFE,
    initialLife: DEFAULT_INITIAL_LIFE,
    mana: 0,
    hand: [],
    field: [], // { instanceId, no, name, faceUp, misfired }
    alive: true,
    spectator: false,
    connected: true,
    shielded: false,
    shieldUntilTurnStart: false,
    reflectUntilTurnStart: false,
    randomizedTurnsLeft: 0,
    pendingRevealCardId: null,
    alphaCards: [],
    turnDrawnCardId: null,
  };
}

function pruneDisconnectedPlayers(room) {
  const stayed = [];
  for (const id of room.order) {
    const p = room.players[id];
    if (p && p.connected === false) {
      delete room.players[id];
    } else {
      stayed.push(id);
    }
  }
  room.order = stayed;
  if (!room.players[room.hostId] && room.order.length > 0) {
    room.hostId = room.order[0];
  }
}

function resetPlayersForNewGame(room) {
  room.blackCardUsage = {};
  room.pendingSearchReturn = null;
  room.pendingTrial = null;
  const initLife = (room.settings && room.settings.initialLife) || DEFAULT_INITIAL_LIFE;
  for (const id of room.order) {
    const p = room.players[id];
    p.life = initLife;
    p.initialLife = initLife;
    p.mana = 0;
    p.hand = [];
    p.field = [];
    p.alive = true;
    p.spectator = false;
    p.shielded = false;
    p.shieldUntilTurnStart = false;
    p.reflectUntilTurnStart = false;
    p.pendingRevealCardId = null;
    p.randomizedTurnsLeft = 0;
    p.alphaCards = [];
    p.turnDrawnCardId = null;
  }
  room.pendingAlphaPicks = null;
  room.alphaCandidates = {};
  shuffle(room.order); // 先攻・席順をランダムに決定(以後は配列順=時計回りで進行)
}

function beginGame(room, io) {
  if (room.settings && room.settings.mode === 'alpha') {
    startAlphaSelection(room, io);
  } else {
    reallyStartGame(room, io);
  }
}

function startAlphaSelection(room, io) {
  const keys = Object.keys(ALPHA_CARDS);
  room.pendingAlphaPicks = new Set(room.order);
  room.alphaCandidates = {};
  for (const id of room.order) {
    const pool = shuffle(keys.slice());
    const candidates = pool.slice(0, 2);
    room.alphaCandidates[id] = candidates;
    const sock = io.sockets.sockets.get(id);
    if (sock) {
      sock.emit('alphaCardChoice', {
        candidates: candidates.map((k) => ({ key: k, name: ALPHA_CARDS[k].name })),
      });
    }
  }
  pushLog(room, ['アルファモード: 各プレイヤーがアルファカードを選択しています…']);
  broadcastState(room);
}

function reallyStartGame(room, io) {
  room.deck = buildDeck(room.cardCounts);
  for (const id of room.order) {
    const p = room.players[id];
    p.hand = [];
    const handSize = 2 + alphaSum(p, 'extraHand');
    for (let i = 0; i < handSize && room.deck.length > 0; i++) p.hand.push(room.deck.pop());
  }
  room.started = true;
  room.ended = false;
  room.winnerId = null;
  room.turnIndex = -1; // advanceTurnで0番目に進む
  room.turnCount = 0;
  pushLog(room, ['ゲームを開始しました']);
  advanceTurn(room, io);
}

function currentPlayerId(room) {
  return room.order[room.turnIndex];
}

function publicPlayerView(room, player, viewerId) {
  const isSelf = player.id === viewerId;
  const viewerIsSpectator = room.players[viewerId] && room.players[viewerId].spectator;
  const showLife = isSelf || viewerIsSpectator || room.settings.showEnemyLife;
  const showMana = isSelf || viewerIsSpectator || room.settings.showEnemyMana;
  const showAlpha = isSelf || viewerIsSpectator || room.settings.alphaCardVisibility !== false;
  return {
    id: player.id,
    name: player.name,
    life: showLife ? player.life : null,
    mana: showMana ? player.mana : null,
    handCount: player.hand.length,
    hand: isSelf ? player.hand : undefined, // 自分の手札のみ中身を送る
    field: player.field.map((f) => {
      const visibleAsFaceUp = f.faceUp && !f.stealth;
      return visibleAsFaceUp || isSelf || viewerIsSpectator ? f : { faceUp: false, hidden: true };
    }),
    alive: player.alive,
    spectator: player.spectator,
    shielded: player.shielded,
    alphaCards: showAlpha ? (player.alphaCards || []).map((k) => ({ key: k, ...ALPHA_CARDS[k] })) : undefined,
  };
}

function buildStateFor(room, viewerId) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    started: room.started,
    ended: room.ended,
    winnerId: room.winnerId,
    deckCount: room.deck.length,
    turnCount: room.turnCount,
    turnLimitEnabled: room.settings.turnLimitEnabled,
    turnLimit: room.settings.turnLimit,
    currentPlayerId: room.started ? currentPlayerId(room) : null,
    order: room.order,
    settings: room.settings,
    cardCounts: room.cardCounts,
    players: room.order.map((id) => publicPlayerView(room, room.players[id], viewerId)),
    you: viewerId,
  };
}

function broadcastState(room) {
  for (const id of room.order) {
    const player = room.players[id];
    if (!player || player.connected === false) continue; // 退室・切断済みの相手には送らない
    const sock = io.sockets.sockets.get(id);
    if (sock) sock.emit('state', buildStateFor(room, id));
  }
}

function pushLog(room, lines) {
  for (const line of lines) {
    room.chatLog.push({ system: true, text: line, ts: Date.now() });
  }
  io.to(room.roomId).emit('systemLog', lines);
}

function checkGameEnd(room) {
  const alive = alivePlayers(room);
  if (alive.length <= 1) {
    room.ended = true;
    room.winnerId = alive[0] ? alive[0].id : null;
    return true;
  }
  if (room.deck.length === 0) {
    endByHighestLife(room);
    return true;
  }
  if (room.settings.turnLimitEnabled && room.turnCount >= room.settings.turnLimit) {
    endByHighestLife(room);
    return true;
  }
  return false;
}

function endByHighestLife(room) {
  room.ended = true;
  const alive = alivePlayers(room);
  let best = null;
  for (const p of alive) {
    if (!best || p.life > best.life) best = p;
  }
  room.winnerId = best ? best.id : null;
}

function advanceTurn(room, io) {
  const finishingId = room.turnIndex >= 0 ? currentPlayerId(room) : null;
  if (finishingId) {
    const finishing = room.players[finishingId];
    if (finishing && finishing.alive) {
      const heal = alphaSum(finishing, 'endTurnHeal');
      if (heal > 0) {
        const before = finishing.life;
        finishing.life = Math.min(finishing.life + heal, finishing.initialLife);
        if (finishing.life > before) {
          pushLog(room, [`${finishing.name} のライフが ${finishing.life - before} 回復した(加護、現在 ${finishing.life})`]);
        }
      }
      const curseDmg = alphaSum(finishing, 'endTurnRandomEnemyDamage');
      if (curseDmg > 0) {
        const enemies = alivePlayers(room).filter((p) => p.id !== finishingId);
        if (enemies.length > 0) {
          const target = enemies[Math.floor(Math.random() * enemies.length)];
          const log = [];
          log.push(`${finishing.name} の呪詛が発動した`);
          dealDamage(room, target.id, curseDmg, log, finishingId);
          pushLog(room, log);
        }
      }
    }
  }
  if (checkGameEnd(room)) {
    broadcastState(room);
    return;
  }
  // 次の生存プレイヤーへ
  let tries = 0;
  do {
    room.turnIndex = (room.turnIndex + 1) % room.order.length;
    tries++;
  } while (
    (!room.players[currentPlayerId(room)].alive || room.players[currentPlayerId(room)].spectator) &&
    tries <= room.order.length
  );
  room.turnCount++;

  const p = room.players[currentPlayerId(room)];
  // ターン開始処理: シールド解除(自分のターンが来たので前回の防御は失効), マナ回復, 1枚ドロー
  p.shielded = false;
  p.reflectUntilTurnStart = false;
  if (alphaSum(p, 'noManaRegen') > 0) {
    // 賭酔: マナが自然回復しない
  } else if (p.mana < 0) {
    p.mana += 4; // マイナスの場合は固定+4で回復
  } else {
    p.mana += manaRegenAmount(p.mana);
  }
  if (p.pendingRevealCardId) {
    // 反逆: 次の自分のターン開始時に正体を公開し、マナ3を消費する
    const fieldCard = p.field.find((f) => f.instanceId === p.pendingRevealCardId);
    if (fieldCard) fieldCard.stealth = false;
    p.mana = Math.max(0, p.mana - 3);
    pushLog(room, [`${p.name} の裏向きだったカードは「反逆」だったことが明らかになった(マナ3消費)`]);
    p.pendingRevealCardId = null;
  }
  p.turnDrawnCardId = null;
  if (room.deck.length > 0) {
    const drawn = room.deck.pop();
    p.hand.push(drawn);
    p.turnDrawnCardId = drawn.instanceId;
  }
  broadcastState(room);
  if (checkGameEnd(room)) broadcastState(room);
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    const room = createRoom(socket.id, name);
    socket.join(room.roomId);
    socket.data.roomId = room.roomId;
    cb && cb({ ok: true, roomId: room.roomId, playerId: socket.id });
    broadcastState(room);
  });

  socket.on('joinRoom', ({ roomId, name }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb && cb({ ok: false, error: 'ルームが見つかりません' });
    if (room.bannedIds && room.bannedIds.has(socket.id)) {
      return cb && cb({ ok: false, error: 'このルームへの参加は許可されていません' });
    }
    if (!room.started && room.order.length >= 6) return cb && cb({ ok: false, error: 'ルームが満員です' });
    const player = newPlayer(socket.id, name);
    if (room.started) {
      // ゲーム中に参加した場合は観戦としてルームに加える(進行中の対戦には参加しない)
      player.spectator = true;
      player.alive = false;
    }
    room.players[socket.id] = player;
    room.order.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    cb && cb({ ok: true, roomId, playerId: socket.id });
    if (room.started) pushLog(room, [`${player.name} が観戦者として参加した`]);
    broadcastState(room);
  });

  socket.on('makeHost', ({ targetId }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id) return;
    const target = room.players[targetId];
    if (!target || target.connected === false || targetId === socket.id) return;
    room.hostId = targetId;
    pushLog(room, [`${target.name} が新しいゲームマスターになりました`]);
    broadcastState(room);
  });

  socket.on('kickPlayer', ({ targetId }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id || targetId === socket.id) return;
    const target = room.players[targetId];
    if (!target) return;
    room.bannedIds = room.bannedIds || new Set();
    room.bannedIds.add(targetId);
    target.connected = false;
    if (room.started) {
      target.alive = false;
      target.spectator = true;
    } else {
      room.order = room.order.filter((id) => id !== targetId);
      delete room.players[targetId];
    }
    const targetSock = io.sockets.sockets.get(targetId);
    if (targetSock) {
      targetSock.emit('kicked');
      targetSock.leave(room.roomId);
      targetSock.data.roomId = null;
    }
    pushLog(room, [`${target.name} が退室させられました`]);
    broadcastState(room);
  });

  socket.on('setCardCounts', (counts) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id || room.started) return;
    room.cardCounts = counts || {};
  });

  socket.on('setGameSettings', (settings) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id || room.started) return;
    room.settings = { ...room.settings, ...settings };
    broadcastState(room);
  });

  socket.on('startGame', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id || room.started) return;
    if (room.order.length < 2) {
      const sock = io.sockets.sockets.get(socket.id);
      if (sock) sock.emit('errorMsg', 'ゲーム開始には2人以上のプレイヤーが必要です');
      return;
    }
    resetPlayersForNewGame(room);
    beginGame(room, io);
  });

  socket.on('pickAlphaCard', ({ key }) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.pendingAlphaPicks || !room.pendingAlphaPicks.has(socket.id)) return;
    const candidates = room.alphaCandidates[socket.id] || [];
    if (!candidates.includes(key)) return;
    const p = room.players[socket.id];
    p.alphaCards = [key];
    const baseLife = (room.settings && room.settings.initialLife) || DEFAULT_INITIAL_LIFE;
    p.initialLife = baseLife + alphaSum(p, 'lifeBonus');
    p.life = p.initialLife;
    room.pendingAlphaPicks.delete(socket.id);
    pushLog(room, [`${p.name} は「${ALPHA_CARDS[key].name}」を選んだ`]);
    if (room.pendingAlphaPicks.size === 0) {
      room.pendingAlphaPicks = null;
      room.alphaCandidates = {};
      reallyStartGame(room, io);
    } else {
      broadcastState(room);
    }
  });

  socket.on('returnToLobby', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id || !room.ended) return;
    room.started = false;
    room.ended = false;
    room.winnerId = null;
    room.deck = [];
    room.turnIndex = 0;
    room.turnCount = 0;
    pruneDisconnectedPlayers(room);
    resetPlayersForNewGame(room);
    pushLog(room, ['ゲームマスターがルームに戻りました']);
    broadcastState(room);
  });

  socket.on('newGame', () => {
    const room = rooms[socket.data.roomId];
    if (!room || room.hostId !== socket.id || !room.ended) return;
    pruneDisconnectedPlayers(room);
    if (room.order.length < 2) {
      const sock = io.sockets.sockets.get(socket.id);
      if (sock) sock.emit('errorMsg', 'ゲーム開始には2人以上のプレイヤーが必要です');
      return;
    }
    resetPlayersForNewGame(room);
    pushLog(room, ['ゲームマスターが新しいゲームを開始しました']);
    beginGame(room, io);
  });

  socket.on('chat', ({ scope, message }) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.settings.chatEnabled) return;
    const sender = room.players[socket.id];
    if (!sender || !message) return;
    const text = String(message).slice(0, 200);
    if (scope === 'all' || !scope) {
      io.to(room.roomId).emit('chatMessage', { from: sender.name, fromId: socket.id, scope: 'all', text });
    } else {
      const target = room.players[scope];
      if (!target) return;
      const payload = { from: sender.name, fromId: socket.id, scope: 'private', toId: scope, text };
      const s1 = io.sockets.sockets.get(socket.id);
      const s2 = io.sockets.sockets.get(scope);
      if (s1) s1.emit('chatMessage', payload);
      if (s2 && s2.id !== s1?.id) s2.emit('chatMessage', payload);
    }
  });

  socket.on('peekHand', ({ targetId }) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.started || room.ended) return;
    if (currentPlayerId(room) !== socket.id) return;
    const target = room.players[targetId];
    if (!target || !target.alive || target.spectator) return;
    const sock = io.sockets.sockets.get(socket.id);
    if (sock) sock.emit('handPeek', { targetId, hand: target.hand });
  });

  socket.on('playCard', (payload) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.started || room.ended) return;
    if (room.pendingSearchReturn || room.pendingTrial) return; // 探索の戻し先選択・裁判の投票中は他の操作を受け付けない
    if (currentPlayerId(room) !== socket.id) return;
    const actor = room.players[socket.id];
    let { instanceId, faceUp, targetId, chosenCost, returnInstanceId, tradeGiveInstanceId, tradeTakeInstanceId } = payload;
    let randomizedThisTurn = false;

    if (actor.randomizedTurnsLeft > 0 && actor.hand.length > 0) {
      // 魘の効果: 表裏・出すカード・対象・コストを強制的にランダム化する
      const randCard = actor.hand[Math.floor(Math.random() * actor.hand.length)];
      instanceId = randCard.instanceId;
      faceUp = Math.random() < 0.5;
      const pool = alivePlayers(room);
      targetId = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : undefined;
      chosenCost = Math.floor(Math.random() * 7) + 1;
      returnInstanceId = undefined;
      actor.randomizedTurnsLeft -= 1;
      randomizedThisTurn = true;
    }

    const idx = actor.hand.findIndex((c) => c.instanceId === instanceId);
    if (idx === -1) return;
    const [card] = actor.hand.splice(idx, 1);
    const randomNotice = randomizedThisTurn ? [`${actor.name} は魘の影響で行動がランダムになった`] : [];

    if (!faceUp) {
      // 裏向き
      actor.field.push({ instanceId: card.instanceId, no: card.no, name: card.name, faceUp: false });
      actor.life = Math.min(actor.life + 1, 999);
      const faceDownLog = [];
      if (actor.alphaCards.includes('corruption')) {
        applyLifeDelta(room, socket.id, -alphaSum(actor, 'otherUseLifeLoss'), '堕落(裏向き使用)', faceDownLog);
      }
      pushLog(room, [...randomNotice, `${actor.name} は裏向きでカードを出した`, ...faceDownLog]);
      advanceTurn(room, io);
      return;
    }

    // 表向き
    let cost = card.baseCost;
    if (card.no === 7) cost = Math.min(7, Math.max(1, chosenCost || 1));
    if (card.no === 13) cost = actor.mana; // 混沌は全マナ(翼のコスト増加はここには適用しない)
    if (card.no === 12) {
      const used = room.blackCardUsage[socket.id] || 0;
      cost = Math.ceil(used * 1.5);
    }
    if (card.no !== 13) cost += alphaSum(actor, 'costPenalty'); // 翼: 全カードの最終コスト+1

    const isStealth = card.no === 10; // 反逆: 発動成功時は場では裏向きに見える
    const fieldEntry = { instanceId: card.instanceId, no: card.no, name: card.name, faceUp: true, misfired: false };

    if (cost == null) cost = 0;
    if (actor.mana < cost) {
      fieldEntry.misfired = true;
      actor.field.push(fieldEntry);
      pushLog(room, [...randomNotice, `${actor.name} は「${card.name}」を表向きで出したが、マナ不足で不発だった`]);
      advanceTurn(room, io);
      return;
    }

    actor.mana -= cost;
    if (isStealth) fieldEntry.stealth = true;
    actor.field.push(fieldEntry);
    const alphaCardLog = [];
    if (card.isBlack) {
      room.blackCardUsage[socket.id] = (room.blackCardUsage[socket.id] || 0) + 1;
      if (actor.alphaCards.includes('corruption')) {
        applyLifeDelta(room, socket.id, alphaSum(actor, 'blackUseLifeGain'), '堕落(黒いカード使用)', alphaCardLog);
      }
      if (actor.alphaCards.includes('apostle')) {
        applyLifeDelta(room, socket.id, -alphaSum(actor, 'blackUseLifeLoss'), '使徒(闇のカード使用)', alphaCardLog);
      }
    } else if (actor.alphaCards.includes('corruption')) {
      applyLifeDelta(room, socket.id, -alphaSum(actor, 'otherUseLifeLoss'), '堕落(黒いカード以外を使用)', alphaCardLog);
    }
    const result = resolveEffect(room, socket.id, card, { targetId, chosenCost: cost, returnInstanceId, tradeGiveInstanceId, tradeTakeInstanceId });
    if (result.extra && result.extra.type === 'roulette') {
      io.to(room.roomId).emit('rouletteResult', result.extra);
    }
    if (isStealth) {
      pushLog(room, [...randomNotice, `${actor.name} は裏向きでカードを出した`, ...alphaCardLog]);
    } else {
      pushLog(room, [...randomNotice, `${actor.name} は「${card.name}」を発動した(コスト${cost})`, ...alphaCardLog, ...result.log]);
    }

    if (result.extra && result.extra.type === 'search_pending') {
      // 探索: 引いた後、戻すカードを選ぶまでターンを進めない
      room.pendingSearchReturn = socket.id;
      const sock = io.sockets.sockets.get(socket.id);
      if (sock) sock.emit('searchReturnPrompt', { hand: actor.hand });
      broadcastState(room);
      return;
    }

    if (result.extra && result.extra.type === 'trial_pending') {
      // 裁判: 全員の投票が揃うまでターンを進めない
      room.pendingTrial = { actingId: socket.id, candidateIds: result.extra.candidateIds, votes: {} };
      const candidates = result.extra.candidateIds.map((id) => ({
        id,
        name: room.players[id].name,
        life: room.players[id].life,
        mana: room.players[id].mana,
      }));
      for (const id of result.extra.candidateIds) {
        const sock = io.sockets.sockets.get(id);
        if (sock) sock.emit('trialStart', { candidates, actingName: actor.name });
      }
      broadcastState(room);
      return;
    }

    advanceTurn(room, io);
  });

  socket.on('playExclusiveCard', ({ exclusiveKey, targetId }) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.started || room.ended) return;
    if (room.pendingSearchReturn || room.pendingTrial) return;
    if (currentPlayerId(room) !== socket.id) return;
    if (!room.settings || room.settings.mode !== 'alpha') return;
    const actor = room.players[socket.id];
    if (!hasExclusive(actor, exclusiveKey)) return;

    const info = EXCLUSIVE_CARD_INFO[exclusiveKey];
    if (!info) return;
    if (actor.mana < info.cost) {
      pushLog(room, [`${actor.name} は「${info.name}」を使おうとしたが、マナが足りなかった`]);
      broadcastState(room);
      return;
    }

    const log = [];
    if (exclusiveKey === 'divinePunishment') {
      if (!targetId || !room.players[targetId] || !room.players[targetId].alive || targetId === socket.id) return;
      actor.mana -= info.cost;
      resolveDivinePunishment(room, socket.id, targetId, log);
    } else if (exclusiveKey === 'gamble') {
      actor.mana -= info.cost;
      resolveGamble(room, socket.id, log);
    } else {
      return;
    }

    // 専用カードを使った場合、このターンに山札から引いたカードは山札に戻す(手札枚数を通常通りに保つため)
    if (actor.turnDrawnCardId) {
      const idx = actor.hand.findIndex((c) => c.instanceId === actor.turnDrawnCardId);
      if (idx >= 0) {
        const [ret] = actor.hand.splice(idx, 1);
        room.deck.push(ret);
        shuffle(room.deck);
      }
      actor.turnDrawnCardId = null;
    }

    pushLog(room, log);
    advanceTurn(room, io);
  });

  socket.on('searchReturn', ({ returnInstanceId }) => {
    const room = rooms[socket.data.roomId];
    if (!room || room.pendingSearchReturn !== socket.id) return;
    const actor = room.players[socket.id];
    const idx = actor.hand.findIndex((c) => c.instanceId === returnInstanceId);
    if (idx === -1) return;
    const [ret] = actor.hand.splice(idx, 1);
    room.deck.push(ret);
    shuffle(room.deck);
    room.pendingSearchReturn = null;
    pushLog(room, [`${actor.name} は手札を1枚山札に戻した`]);
    advanceTurn(room, io);
    broadcastState(room);
  });

  socket.on('castTrialVote', ({ targetId }) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.pendingTrial) return;
    const trial = room.pendingTrial;
    if (!trial.candidateIds.includes(socket.id)) return;
    if (trial.votes[socket.id] != null) return; // 二重投票は無視
    if (!targetId || !room.players[targetId]) return;
    trial.votes[socket.id] = targetId;
    const votedCount = Object.keys(trial.votes).length;
    io.to(room.roomId).emit('trialVoteUpdate', { votedCount, totalVoters: trial.candidateIds.length });

    if (votedCount >= trial.candidateIds.length) {
      const resultLog = resolveTrialVotes(room, trial.votes, trial.actingId);
      pushLog(room, resultLog);
      room.pendingTrial = null;
      io.to(room.roomId).emit('trialEnd');
      advanceTurn(room, io);
      broadcastState(room);
    }
  });

  socket.on('surrender', () => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.started) return;
    const p = room.players[socket.id];
    if (!p) return;
    p.alive = false;
    p.spectator = true;
    pushLog(room, [`${p.name} は降参した`]);
    if (currentPlayerId(room) === socket.id) advanceTurn(room, io);
    else { checkGameEnd(room); broadcastState(room); }
  });

  socket.on('leaveRoom', () => {
    handleLeave(socket);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
  });

  function handleLeave(socket) {
    const roomId = socket.data.roomId;
    const room = rooms[roomId];
    if (!room) return;
    const p = room.players[socket.id];
    if (p) {
      p.connected = false;
      if (room.started) {
        p.alive = false;
        p.spectator = true;
        pushLog(room, [`${p.name} が退室した`]);
        if (room.pendingSearchReturn === socket.id) {
          // 戻すカードを選ぶ前に抜けた場合はランダムに1枚戻してターンを進める
          if (p.hand.length > 0) {
            const idx = Math.floor(Math.random() * p.hand.length);
            const [ret] = p.hand.splice(idx, 1);
            room.deck.push(ret);
            shuffle(room.deck);
          }
          room.pendingSearchReturn = null;
        }
        if (room.pendingTrial && room.pendingTrial.candidateIds.includes(socket.id)) {
          room.pendingTrial.candidateIds = room.pendingTrial.candidateIds.filter((id) => id !== socket.id);
          delete room.pendingTrial.votes[socket.id];
          if (room.pendingTrial.candidateIds.length > 0 && Object.keys(room.pendingTrial.votes).length >= room.pendingTrial.candidateIds.length) {
            const resultLog = resolveTrialVotes(room, room.pendingTrial.votes, room.pendingTrial.actingId);
            pushLog(room, resultLog);
            room.pendingTrial = null;
            io.to(room.roomId).emit('trialEnd');
          } else if (room.pendingTrial.candidateIds.length === 0) {
            room.pendingTrial = null;
          }
        }
        if (currentPlayerId(room) === socket.id) advanceTurn(room, io);
      } else {
        room.order = room.order.filter((id) => id !== socket.id);
        delete room.players[socket.id];
        if (room.hostId === socket.id && room.order.length > 0) room.hostId = room.order[0];
      }
    }
    if (room.order.filter((id) => room.players[id] && room.players[id].connected).length === 0) {
      delete rooms[roomId];
      return;
    }
    checkGameEnd(room);
    broadcastState(room);
    socket.data.roomId = null;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
