// ============================================================
// カード定義と効果処理
// ============================================================
// カードNo.は 1〜13 が基本カード、0 がシークレットカード(破滅/豪運)。
// コストが固定でないカード(7,12,13)は baseCost を null にしている。
// ============================================================

const CARD_DEFS = {
  1:  { name: '探索', baseCost: 1, isBlack: false, isSecret: false, defaultCount: 4 },
  2:  { name: '治療', baseCost: 1, isBlack: false, isSecret: false, defaultCount: 4 },
  3:  { name: '強奪', baseCost: 2, isBlack: true,  isSecret: false, defaultCount: 4 },
  4:  { name: '攻撃', baseCost: 2, isBlack: true,  isSecret: false, defaultCount: 4 },
  5:  { name: '防御', baseCost: 2, isBlack: false, isSecret: false, defaultCount: 3 },
  6:  { name: '取引', baseCost: 3, isBlack: false, isSecret: false, defaultCount: 3 },
  7:  { name: '賭博', baseCost: null, isBlack: true,  isSecret: false, defaultCount: 3 }, // コストは1〜7でプレイヤーが選択
  8:  { name: '戦争', baseCost: 4, isBlack: true,  isSecret: false, defaultCount: 3 },
  9:  { name: '輪廻', baseCost: 5, isBlack: false, isSecret: false, defaultCount: 2 },
  10: { name: '反逆', baseCost: 3, isBlack: false, isSecret: false, defaultCount: 2 },
  11: { name: '深淵', baseCost: 6, isBlack: false, isSecret: false, defaultCount: 1 },
  12: { name: '浄化', baseCost: null, isBlack: false, isSecret: false, defaultCount: 1 }, // コストは使用済み黒いカード枚数×1.5(切り上げ)
  13: { name: '混沌', baseCost: null, isBlack: true,  isSecret: false, defaultCount: 1 }, // コストは全マナ
  0.1: { no: 0, name: '破滅', baseCost: 0, isBlack: true,  isSecret: true, defaultCount: 1, secretKey: 'destruction' },
  0.2: { no: 0, name: '豪運', baseCost: 0, isBlack: false, isSecret: true, defaultCount: 1, secretKey: 'luck' },
};

const MANA_CAP_DISPLAY = 15; // これ以上は自動回復しない(保持は可能)

function ceilDiv(numerator) {
  return Math.ceil(numerator);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let instanceCounter = 1;
function makeInstance(no, secretKey) {
  const def = secretKey ? CARD_DEFS[secretKey === 'destruction' ? 0.1 : 0.2] : CARD_DEFS[no];
  return {
    instanceId: 'c' + (instanceCounter++),
    no: secretKey ? 0 : no,
    name: def.name,
    baseCost: def.baseCost,
    isBlack: def.isBlack,
    isSecret: def.isSecret,
    secretKey: secretKey || null,
  };
}

// cardCounts: { "1": 4, "2": 4, ..., "13": 1, "destruction": 1(0/1), "luck": 1(0/1) }
function buildDeck(cardCounts) {
  const deck = [];
  for (let no = 1; no <= 13; no++) {
    const count = cardCounts[no] != null ? cardCounts[no] : CARD_DEFS[no].defaultCount;
    for (let i = 0; i < count; i++) deck.push(makeInstance(no));
  }
  if (cardCounts.destruction !== 0) deck.push(makeInstance(0, 'destruction'));
  if (cardCounts.luck !== 0) deck.push(makeInstance(0, 'luck'));
  return shuffle(deck);
}

// ターン開始時のマナ回復量(逓減式)
function manaRegenAmount(currentMana) {
  if (currentMana <= 5) return 3;
  if (currentMana <= 10) return 2;
  if (currentMana <= 14) return 1;
  return 0;
}

function alivePlayers(room) {
  return room.order
    .map((id) => room.players[id])
    .filter((p) => p && p.alive && !p.spectator);
}

function otherAlivePlayers(room, selfId) {
  return alivePlayers(room).filter((p) => p.id !== selfId);
}

function dealDamage(room, targetId, amount, log) {
  const p = room.players[targetId];
  if (!p || !p.alive) return;
  if (p.shielded) {
    log.push(`${p.name} は防御中のため効果を受けなかった`);
    return;
  }
  p.life -= amount;
  log.push(`${p.name} は ${amount} ダメージを受けた(残りライフ ${Math.max(p.life, 0)})`);
  if (p.life <= 0) {
    p.life = 0;
    p.alive = false;
    p.spectator = true;
    log.push(`${p.name} は力尽き、観戦に回った`);
  }
}

function healLife(room, targetId, amount, log, cap) {
  const p = room.players[targetId];
  if (!p || !p.alive) return;
  const before = p.life;
  p.life = Math.min(p.life + amount, cap != null ? cap : p.life + amount);
  log.push(`${p.name} のライフが ${p.life - before} 回復した(現在 ${p.life})`);
}

function loseMana(room, targetId, amount, log) {
  const p = room.players[targetId];
  if (!p) return;
  const before = p.mana;
  p.mana = Math.max(0, p.mana - amount);
  log.push(`${p.name} のマナが ${before - p.mana} 減少した(現在 ${p.mana})`);
}

function gainMana(room, targetId, amount, log) {
  const p = room.players[targetId];
  if (!p) return;
  p.mana += amount;
  log.push(`${p.name} のマナが ${amount} 増加した(現在 ${p.mana})`);
}

// ------------------------------------------------------------
// 効果本体
// opts: { targetId, chosenCost, tradeSelection, ... } 効果ごとに使うものだけ参照
// 戻り値: { log: string[] }  ※room は直接書き換える
// ------------------------------------------------------------
function resolveEffect(room, actingId, card, opts = {}) {
  const log = [];
  let extra = null;
  const actor = room.players[actingId];
  const no = card.secretKey ? card.secretKey : card.no;

  switch (no) {
    case 1: { // 探索
      if (room.deck.length > 0) {
        const drawn = room.deck.pop();
        actor.hand.push(drawn);
        log.push(`${actor.name} は山札から1枚引いた`);
      }
      if (opts.returnInstanceId) {
        const idx = actor.hand.findIndex((c) => c.instanceId === opts.returnInstanceId);
        if (idx >= 0) {
          const [ret] = actor.hand.splice(idx, 1);
          room.deck.push(ret);
          shuffle(room.deck);
          log.push(`${actor.name} は手札を1枚山札に戻した`);
        }
      }
      break;
    }
    case 2: { // 治療
      healLife(room, actingId, 3, log, actor.initialLife);
      break;
    }
    case 3: { // 強奪
      const t = opts.targetId;
      if (t) {
        const amount = Math.min(3, room.players[t].mana);
        loseMana(room, t, amount, log);
        gainMana(room, actingId, amount, log);
      }
      break;
    }
    case 4: { // 攻撃
      const t = opts.targetId || actingId;
      dealDamage(room, t, 3, log);
      dealDamage(room, actingId, 1, log);
      break;
    }
    case 5: { // 防御
      actor.shielded = true;
      actor.shieldUntilTurnStart = true; // 次の自分のターン開始まで
      log.push(`${actor.name} は防御態勢に入った`);
      break;
    }
    case 6: { // 取引: 相手の手札から1枚選び、自分の手札1枚と交換する
      const t = opts.targetId;
      if (t && room.players[t] && opts.tradeGiveInstanceId && opts.tradeTakeInstanceId) {
        const target = room.players[t];
        const giveIdx = actor.hand.findIndex((c) => c.instanceId === opts.tradeGiveInstanceId);
        const takeIdx = target.hand.findIndex((c) => c.instanceId === opts.tradeTakeInstanceId);
        if (giveIdx >= 0 && takeIdx >= 0) {
          const [giveCard] = actor.hand.splice(giveIdx, 1);
          const [takeCard] = target.hand.splice(takeIdx, 1);
          actor.hand.push(takeCard);
          target.hand.push(giveCard);
          log.push(`${actor.name} と ${target.name} はカードを1枚ずつ交換した`);
        }
      }
      break;
    }
    case 7: { // 賭博
      const t = opts.targetId;
      const cost = opts.chosenCost || 1;
      if (t) {
        const selfRoll = Math.min(10, Math.floor(Math.random() * 10) + 1 + 2); // +2アドバンテージ
        const targetRoll = Math.floor(Math.random() * 10) + 1;
        log.push(`${actor.name} のルーレット: ${selfRoll} / ${room.players[t].name} のルーレット: ${targetRoll}`);
        extra = { type: 'roulette', actorId: actingId, actorName: actor.name, actorRoll: selfRoll, targetIdRoll: t, targetName: room.players[t].name, targetRoll };
        const diff = selfRoll - targetRoll;
        if (diff === 0) {
          dealDamage(room, actingId, cost, log);
          dealDamage(room, t, cost, log);
          log.push('引き分け:お互いコスト分のダメージを受けた');
        } else if (diff > 0) {
          const dmg = ceilDiv((diff * cost) / 6);
          dealDamage(room, t, dmg, log);
          const manaMove = Math.min(ceilDiv(diff / 2), room.players[t].mana);
          loseMana(room, t, manaMove, log);
          gainMana(room, actingId, manaMove, log);
        } else {
          const dmg = ceilDiv((-diff * cost) / 6);
          dealDamage(room, actingId, dmg, log);
          const manaMove = Math.min(ceilDiv(-diff / 2), actor.mana);
          loseMana(room, actingId, manaMove, log);
          gainMana(room, t, manaMove, log);
        }
      }
      break;
    }
    case 8: { // 戦争(旧No.9)
      const t = opts.targetId;
      if (t) {
        const selfSum = actor.hand.reduce((s, c) => s + c.no, 0);
        const targetSum = room.players[t].hand.reduce((s, c) => s + c.no, 0);
        log.push(`${actor.name} の手札No.合計: ${selfSum} / ${room.players[t].name}: ${targetSum}`);
        if (selfSum > targetSum) dealDamage(room, t, selfSum - targetSum, log);
        else if (targetSum > selfSum) dealDamage(room, actingId, targetSum - selfSum, log);
        else log.push('引き分け:ダメージなし');
      }
      break;
    }
    case 9: { // 輪廻(旧No.8)
      actor.life = actor.initialLife;
      actor.mana = 3;
      room.deck.push(...actor.hand);
      actor.hand = [];
      shuffle(room.deck);
      for (let i = 0; i < 2 && room.deck.length > 0; i++) actor.hand.push(room.deck.pop());
      log.push(`${actor.name} はライフ・マナをリセットし、手札を入れ替えた`);
      break;
    }
    case 10: { // 反逆(見た目は裏向きカードとして扱うため、効果ログは出さない)
      actor.reflectUntilTurnStart = true;
      break;
    }
    case 11: { // 深淵
      for (let i = 0; i < 2; i++) {
        const blackIdx = room.deck.findIndex((c) => c.isBlack);
        if (blackIdx === -1) break;
        const [drawn] = room.deck.splice(blackIdx, 1);
        log.push(`${actor.name} は深淵から黒いカード「${drawn.name}」を引いた`);
        actor.field.push({ instanceId: drawn.instanceId, no: drawn.no, name: drawn.name, faceUp: true, misfired: false });
        const subOpts = { targetId: opts.subTargets ? opts.subTargets[i] : opts.targetId, chosenCost: drawn.baseCost || 3 };
        const sub = resolveEffect(room, actingId, drawn, subOpts);
        log.push(...sub.log);
      }
      break;
    }
    case 12: { // 浄化
      for (const p of alivePlayers(room)) {
        const usedCount = room.blackCardUsage[p.id] || 0;
        if (usedCount > 0) dealDamage(room, p.id, usedCount * 2, log);
        const blackInHand = p.hand.filter((c) => c.isBlack).length;
        if (blackInHand > 0) loseMana(room, p.id, blackInHand * 2, log);
      }
      break;
    }
    case 13: { // 混沌
      const spent = opts.chosenCost || actor.mana;
      const rare = Math.random() < 0.02; // 魘(超低確率)
      if (rare) {
        log.push('魘が発動!全プレイヤーは3ターンの間、行動がランダムになる');
        for (const p of alivePlayers(room)) p.randomizedTurnsLeft = 3;
        break;
      }
      let scale = 'small';
      if (spent >= 11) scale = 'large';
      else if (spent >= 6) scale = 'medium';
      const pick = Math.floor(Math.random() * 4);
      const targets = alivePlayers(room);
      if (scale === 'small') {
        if (pick === 0) { log.push('【つむじ風】が発動'); for (const p of targets) dealDamage(room, p.id, p.id === actingId ? 2 : 3, log); for (const p of targets) loseMana(room, p.id, 2, log); }
        else if (pick === 1) { log.push('【落石】が発動'); for (let i = 0; i < 4; i++) { const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, 2, log); } }
        else if (pick === 2) { log.push('【混乱】が発動'); const hands = targets.map((p) => p.hand); for (let i = 0; i < targets.length; i++) targets[i].hand = hands[(i + 1) % hands.length]; log.push('全プレイヤーの手札が入れ替わった'); }
        else { log.push('【裁判】が発動'); for (const p of targets) healLife(room, p.id, 1, log, p.initialLife); for (const p of targets) loseMana(room, p.id, 1, log); }
      } else if (scale === 'medium') {
        if (pick === 0) { log.push('【竜巻】が発動'); for (const p of targets) { loseMana(room, p.id, 3, log); dealDamage(room, p.id, p.id === actingId ? 4 : 5, log); } const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, 3, log); }
        else if (pick === 1) { log.push('【隕石】が発動'); for (let i = 0; i < 4; i++) { const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, 4, log); } }
        else if (pick === 2) { log.push('【命水】が発動'); for (const p of targets) healLife(room, p.id, 5, log, null); }
        else { log.push('【疫病】が発動'); const roll = Math.floor(Math.random() * 10) + 1; const dmg = ceilDiv((targets.length * roll) / 3); for (const p of targets) dealDamage(room, p.id, p.id === actingId ? Math.max(0, dmg - 1) : dmg, log); }
      } else {
        if (pick === 0) { log.push('【テンペスト】が発動'); for (const p of targets) p.life = Math.max(1, Math.min(3, Math.floor(Math.random() * 3) + 1)); log.push('全員のライフが1〜3のいずれかになった'); }
        else if (pick === 1) { log.push('【スターレイン】が発動'); for (let i = 0; i < 10; i++) { const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, Math.floor(Math.random() * 3) + 1, log); } }
        else if (pick === 2) { log.push('【アノマリー】が発動'); room.chaosBlackBias = true; for (const p of targets) { room.deck.push(...p.hand); p.hand = []; } shuffle(room.deck); for (const p of targets) { const upper = 1 + Math.floor(Math.random() * 4); for (let i = 0; i < upper && room.deck.length > 0; i++) p.hand.push(room.deck.pop()); healLife(room, p.id, 7 - p.hand.length, log, p.initialLife); } }
        else { log.push('【ラグナロク】が発動'); for (const p of targets) { const faceDownCount = p.field.filter((f) => !f.faceUp).length; dealDamage(room, p.id, Math.max(0, 12 - faceDownCount), log); } }
      }
      break;
    }
    case 'destruction': { // 破滅
      for (const p of alivePlayers(room)) { p.life = 1; p.mana = 0; }
      log.push('破滅が発動:全プレイヤーのライフが1、マナが0になった');
      break;
    }
    case 'luck': { // 豪運
      healLife(room, actingId, 5, log, actor.initialLife + 5);
      gainMana(room, actingId, 3, log);
      if (room.deck.length > 0 && opts.pickFromDeckIndex != null) {
        const idx = Math.min(opts.pickFromDeckIndex, room.deck.length - 1);
        const [picked] = room.deck.splice(idx, 1);
        if (opts.returnInstanceId) {
          const hi = actor.hand.findIndex((c) => c.instanceId === opts.returnInstanceId);
          if (hi >= 0) { room.deck.push(actor.hand[hi]); actor.hand.splice(hi, 1, picked); }
        } else {
          actor.hand.push(picked);
        }
        shuffle(room.deck);
      }
      actor.shielded = true;
      actor.shieldUntilTurnStart = true;
      log.push(`${actor.name} は豪運を発動した`);
      break;
    }
    default:
      log.push('未実装の効果です');
  }
  return { log, extra };
}

module.exports = {
  CARD_DEFS,
  buildDeck,
  shuffle,
  manaRegenAmount,
  MANA_CAP_DISPLAY,
  resolveEffect,
  alivePlayers,
  otherAlivePlayers,
  dealDamage,
};
