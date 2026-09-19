const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  buildDeck,
  shuffle,
  manaRegenAmount,
  resolveEffect,
  alivePlayers,
  dealDamage,
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
      turnLimitEnabled: false,
      turnLimit: 20,
      chatEnabled: true,
      showEnemyLife: true,
      showEnemyMana: true,
    },
    cardCounts: {}, // 空なら cards.js のデフォルトを使う
    blackCardUsage: {}, // playerId -> 累計使用黒いカード枚数
    chatLog: [],
    started: false,
    ended: false,
    winnerId: null,
    turnCount: 0,
  };
  rooms[roomId] = room;
  return room;
}

function newPlayer(id, name) {
  return {
    id,
    name: (name || 'プレイヤー').slice(0, 10),
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
  };
}

function currentPlayerId(room) {
  return room.order[room.turnIndex];
}

function publicPlayerView(room, player, viewerId) {
  const isSelf = player.id === viewerId;
  const viewerIsSpectator = room.players[viewerId] && room.players[viewerId].spectator;
  const showLife = isSelf || viewerIsSpectator || room.settings.showEnemyLife;
  const showMana = isSelf || viewerIsSpectator || room.settings.showEnemyMana;
  return {
    id: player.id,
    name: player.name,
    life: showLife ? player.life : null,
    mana: showMana ? player.mana : null,
    handCount: player.hand.length,
    hand: isSelf ? player.hand : undefined, // 自分の手札のみ中身を送る
    field: player.field.map((f) => (f.faceUp || isSelf || viewerIsSpectator ? f : { faceUp: false, hidden: true })),
    alive: player.alive,
    spectator: player.spectator,
    shielded: player.shielded,
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
    players: room.order.map((id) => publicPlayerView(room, room.players[id], viewerId)),
    you: viewerId,
  };
}

function broadcastState(room) {
  for (const id of room.order) {
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
  const regen = manaRegenAmount(p.mana);
  p.mana += regen;
  if (room.deck.length > 0) {
    const drawn = room.deck.pop();
    p.hand.push(drawn);
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
    if (room.started) return cb && cb({ ok: false, error: 'すでにゲームが開始されています' });
    if (room.order.length >= 6) return cb && cb({ ok: false, error: 'ルームが満員です' });
    room.players[socket.id] = newPlayer(socket.id, name);
    room.order.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;
    cb && cb({ ok: true, roomId, playerId: socket.id });
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
    room.deck = buildDeck(room.cardCounts);
    for (const id of room.order) {
      const p = room.players[id];
      p.hand = [];
      for (let i = 0; i < 2 && room.deck.length > 0; i++) p.hand.push(room.deck.pop());
    }
    room.started = true;
    room.turnIndex = -1; // advanceTurnで0番目に進む
    room.turnCount = 0;
    pushLog(room, ['ゲームを開始しました']);
    advanceTurn(room, io);
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

  socket.on('playCard', (payload) => {
    const room = rooms[socket.data.roomId];
    if (!room || !room.started || room.ended) return;
    if (currentPlayerId(room) !== socket.id) return;
    const actor = room.players[socket.id];
    const { instanceId, faceUp, targetId, chosenCost } = payload;
    const idx = actor.hand.findIndex((c) => c.instanceId === instanceId);
    if (idx === -1) return;
    const [card] = actor.hand.splice(idx, 1);

    if (!faceUp) {
      // 裏向き
      actor.field.push({ instanceId: card.instanceId, no: card.no, name: card.name, faceUp: false });
      actor.life = Math.min(actor.life + 1, 999);
      pushLog(room, [`${actor.name} は裏向きでカードを出した`]);
      advanceTurn(room, io);
      return;
    }

    // 表向き
    let cost = card.baseCost;
    if (card.no === 7) cost = Math.min(7, Math.max(1, chosenCost || 1));
    if (card.no === 13) cost = actor.mana; // 混沌は全マナ
    if (card.no === 12) {
      const used = room.blackCardUsage[socket.id] || 0;
      cost = Math.ceil(used * 1.5);
    }

    const fieldEntry = { instanceId: card.instanceId, no: card.no, name: card.name, faceUp: true, misfired: false };

    if (cost == null) cost = 0;
    if (actor.mana < cost) {
      fieldEntry.misfired = true;
      actor.field.push(fieldEntry);
      pushLog(room, [`${actor.name} は「${card.name}」を表向きで出したが、マナ不足で不発だった`]);
      advanceTurn(room, io);
      return;
    }

    actor.mana -= cost;
    actor.field.push(fieldEntry);
    if (card.isBlack) {
      room.blackCardUsage[socket.id] = (room.blackCardUsage[socket.id] || 0) + 1;
    }
    const result = resolveEffect(room, socket.id, card, { targetId, chosenCost: cost });
    pushLog(room, [`${actor.name} は「${card.name}」を発動した(コスト${cost})`, ...result.log]);
    advanceTurn(room, io);
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
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
