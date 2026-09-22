// ============================================================
// カード定義と効果処理
// ============================================================
// カードNo.は 1〜13 が基本カード、0 がシークレットカード(破滅/豪運)。
// コストが固定でないカード(7,12,13)は baseCost を null にしている。
// ============================================================

// ========== アルファモード専用カード ==========
const ALPHA_CARDS = {
  blessing: { name: '加護', lifeBonus: 5, endTurnHeal: 1 },
  toughness: { name: '強靭', lifeBonus: 7, damageReduction: 1 },
  training: { name: '鍛錬', lifeBonus: 3, damagePerFaceDown15: 1 },
  magicSword: { name: '魔剣', damageBonus: 3, recoilPerUse: 1 },
  wings: { name: '翼', extraHand: 1, costPenalty: 1 },
  muscle: { name: '筋肉', lifeBonus: 7, damageBonus: 2, damageReduction: 2, extraHand: -1 },
  berserk: { name: '狂化', lifeBonus: 13, damageBonus: 2, noHeal: true },
  corruption: { name: '堕落', damagePerTwoBlackUsed: 1, blackUseLifeGain: 2, otherUseLifeLoss: 1 },
  apostle: { name: '使徒', lifeBonus: 3, exclusiveCard: 'divinePunishment', blackUseLifeLoss: 4 },
  curse: { name: '呪詛', lifeBonus: 3, endTurnRandomEnemyDamage: 2, damageTakenBonus: 1 },
  gambler: { name: '賭酔', rouletteBonus: 1, turnStartGamble: true, manaRegenPenalty: 1 },
  regen: { name: '再生', damageBonus: -1, reviveOnce: true },
  karakuri: { name: '絡繰', lifeBonus: -3, manaAsLifeBuffer: true },
};

const EXCLUSIVE_CARD_INFO = {
  divinePunishment: { name: '神罰', cost: 4 },
};

function alphaSum(player, field) {
  if (!player || !player.alphaCards || player.alphaCards.length === 0) return 0;
  let total = 0;
  for (const key of player.alphaCards) {
    const ac = ALPHA_CARDS[key];
    if (ac && ac[field]) total += ac[field];
  }
  return total;
}

function hasExclusive(player, exclusiveKey) {
  if (!player || !player.alphaCards) return false;
  return player.alphaCards.some((key) => ALPHA_CARDS[key] && ALPHA_CARDS[key].exclusiveCard === exclusiveKey);
}

// アルファカードを手に入れた/失った際に手札上限が変わった場合、その場で枚数を合わせる
// (翼で上限が増えた場合は山札から補充、筋肉などで上限が減った場合はランダムに山札へ戻す)
function adjustHandCapAfterAlphaChange(room, player, log) {
  const cap = 2 + alphaSum(player, 'extraHand');
  if (player.hand.length < cap) {
    while (player.hand.length < cap && room.deck.length > 0) {
      player.hand.push(room.deck.pop());
    }
    log.push(`${player.name} は手札上限の変化により山札から補充した(現在 ${player.hand.length}枚)`);
  } else if (player.hand.length > cap) {
    const returned = [];
    while (player.hand.length > cap) {
      const idx = Math.floor(Math.random() * player.hand.length);
      const [c] = player.hand.splice(idx, 1);
      returned.push(c);
    }
    room.deck.push(...returned);
    shuffle(room.deck);
    log.push(`${player.name} は手札上限の変化により、あふれた${returned.length}枚をランダムに山札へ戻した`);
  }
}

// ライフの増減(ダメージ以外の要因)。増加は狂化の「回復できない」対象になり、初期ライフを超えない。
// 減少は上限なく適用され、0以下で撃破扱いになる(ただしこの経路での撃破はアルファカードの継承を行わない)。
function applyLifeDelta(room, playerId, delta, reason, log, uncapped) {
  const p = room.players[playerId];
  if (!p || !p.alive || delta === 0) return;
  if (delta > 0) {
    if (alphaSum(p, 'noHeal') > 0) {
      log.push(`${p.name} は${reason}でライフが回復するはずだったが、狂化により回復しなかった`);
      return;
    }
    const before = p.life;
    const capped = uncapped ? p.life + delta : Math.min(p.life + delta, p.initialLife);
    p.life = Math.max(p.life, capped); // 既に上限を超えている場合でも回復で減らさない
    if (p.life > before) log.push(`${p.name} のライフが ${p.life - before} 増加した(${reason}、現在 ${p.life})`);
  } else {
    const before = p.life;
    p.life = Math.max(0, p.life + delta);
    log.push(`${p.name} のライフが ${before - p.life} 減少した(${reason}、現在 ${p.life})`);
    if (p.life <= 0) {
      p.alive = false;
      p.spectator = true;
      log.push(`${p.name} は力尽き、観戦に回った`);
    }
  }
}

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
  10: { name: '反逆', baseCost: 0, isBlack: false, isSecret: false, defaultCount: 2 },
  11: { name: '深淵', baseCost: 6, isBlack: true, isSecret: false, defaultCount: 1 },
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

function dealDamage(room, targetId, amount, log, attackerId, _reflected, fixed) {
  const p = room.players[targetId];
  if (!p || !p.alive) return 0;
  if (!_reflected && p.reflectUntilTurnStart && attackerId && attackerId !== targetId && room.players[attackerId]) {
    log.push(`${p.name} は反逆の効果で攻撃を跳ね返した`);
    return dealDamage(room, attackerId, amount, log, targetId, true, fixed);
  }
  let dmg = amount;
  if (!fixed) {
    if (attackerId && attackerId !== targetId) {
      const attacker = room.players[attackerId];
      if (attacker) {
        dmg += alphaSum(attacker, 'damageBonus');
        const faceDownCount = attacker.field.filter((f) => !f.faceUp).length;
        dmg += Math.floor(faceDownCount / 1.5) * alphaSum(attacker, 'damagePerFaceDown15');
        const blackUsed = room.blackCardUsage ? (room.blackCardUsage[attackerId] || 0) : 0;
        dmg += Math.floor(blackUsed / 2) * alphaSum(attacker, 'damagePerTwoBlackUsed');
      }
    }
    dmg -= alphaSum(p, 'damageReduction');
    dmg += alphaSum(p, 'damageTakenBonus');
    dmg = Math.max(0, dmg);
  }
  if (p.shielded) {
    log.push(`${p.name} は防御中のため効果を受けなかった`);
    return 0;
  }

  let manaSpentByKarakuri = 0;
  let willBeLifeWithoutSave = p.life - dmg;
  const wasFatalBeforeBuffer = willBeLifeWithoutSave < 0;
  let survivedByKarakuri = false;
  if (wasFatalBeforeBuffer && alphaSum(p, 'manaAsLifeBuffer') > 0) {
    // 絡繰: 2マナを1ライフとして代用し、致命的な分だけマナで肩代わりする
    const shortfall = -willBeLifeWithoutSave;
    const maxCoverableByMana = Math.floor(p.mana / 2);
    const covered = Math.min(shortfall, maxCoverableByMana);
    if (covered > 0) {
      manaSpentByKarakuri = covered * 2;
      p.mana -= manaSpentByKarakuri;
      willBeLifeWithoutSave += covered;
      log.push(`${p.name} は絡繰の効果でマナ${manaSpentByKarakuri}を代わりに消費した(残りマナ ${p.mana})`);
    }
    if (willBeLifeWithoutSave >= 0) survivedByKarakuri = true; // 致命傷分をマナで完全に肩代わりできた
  }

  p.life = willBeLifeWithoutSave;
  log.push(`${p.name} は ${dmg} ダメージを受けた(残りライフ ${Math.max(p.life, 0)})`);
  if (p.life <= 0 && survivedByKarakuri) {
    p.life = 0; // 絡繰でちょうど持ちこたえた場合は生存扱い(死亡判定に進まない)
    return dmg;
  }
  if (p.life <= 0 && alphaSum(p, 'reviveOnce') > 0 && !p.regenUsed) {
    // 再生: ライフが0以下になった時、一度だけ初期ライフまで戻って生き延びる
    p.regenUsed = true;
    p.life = p.initialLife;
    log.push(`${p.name} は再生の効果でライフが初期値まで回復した(現在 ${p.life})`);
    return dmg;
  }
  if (p.life <= 0) {
    p.life = 0;
    p.alive = false;
    p.spectator = true;
    log.push(`${p.name} は力尽き、観戦に回った`);
    if (attackerId && room.players[attackerId] && p.alphaCards && p.alphaCards.length > 0) {
      const killer = room.players[attackerId];
      const gained = p.alphaCards.map((key) => (ALPHA_CARDS[key] ? ALPHA_CARDS[key].name : key));
      killer.alphaCards.push(...p.alphaCards);
      p.alphaCards = [];
      log.push(`${killer.name} は ${p.name} のアルファカード(${gained.join('、')})を手に入れた`);
      adjustHandCapAfterAlphaChange(room, killer, log);
    }
  }
  return dmg;
}

function healLife(room, targetId, amount, log, cap) {
  const p = room.players[targetId];
  if (!p || !p.alive) return;
  const before = p.life;
  const capped = cap != null ? Math.min(p.life + amount, cap) : p.life + amount;
  p.life = Math.max(p.life, capped); // 既に上限を超えている場合でも回復で減らさない
  log.push(`${p.name} のライフが ${p.life - before} 回復した(現在 ${p.life})`);
}

function loseMana(room, targetId, amount, log) {
  const p = room.players[targetId];
  if (!p) return 0;
  if (p.shielded) {
    log.push(`${p.name} は防御中のため効果を受けなかった`);
    return 0;
  }
  const before = p.mana;
  p.mana = Math.max(0, p.mana - amount);
  const lost = before - p.mana;
  log.push(`${p.name} のマナが ${lost} 減少した(現在 ${p.mana})`);
  return lost;
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

  const lifeBeforeSnapshot = {};
  if (!opts.__nested && actor && actor.alphaCards && actor.alphaCards.includes('magicSword')) {
    for (const id of Object.keys(room.players)) lifeBeforeSnapshot[id] = room.players[id].life;
  }

  switch (no) {
    case 1: { // 探索: まず山札から1枚引く(戻すカードの選択は引いた後、別の操作で行う)
      if (room.deck.length > 0) {
        const drawn = room.deck.pop();
        actor.hand.push(drawn);
        log.push(`${actor.name} は山札から1枚引いた`);
        extra = { type: 'search_pending' };
      }
      break;
    }
    case 2: { // 治療
      healLife(room, actingId, 3, log, actor.initialLife);
      break;
    }
    case 3: { // 強奪
      let attacker = actingId;
      let t = opts.targetId;
      if (t && room.players[t] && room.players[t].reflectUntilTurnStart && t !== actingId) {
        log.push(`${room.players[t].name} は反逆の効果で強奪を跳ね返した`);
        const swap = attacker; attacker = t; t = swap;
      }
      if (t && room.players[t]) {
        const wanted = Math.min(3, room.players[t].mana);
        if (wanted > 0) {
          const lost = loseMana(room, t, wanted, log);
          if (lost > 0) gainMana(room, attacker, lost, log);
        }
      }
      break;
    }
    case 4: { // 攻撃
      const t = opts.targetId || actingId;
      dealDamage(room, t, 3, log, actingId);
      dealDamage(room, actingId, 1, log, actingId);
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
        const selfRoll = Math.min(10, Math.floor(Math.random() * 10) + 1 + 2 + alphaSum(actor, 'rouletteBonus'));
        const targetRoll = Math.min(10, Math.floor(Math.random() * 10) + 1 + alphaSum(room.players[t], 'rouletteBonus'));
        log.push(`${actor.name} のルーレット: ${selfRoll} / ${room.players[t].name} のルーレット: ${targetRoll}`);
        extra = { type: 'roulette', actorId: actingId, actorName: actor.name, actorRoll: selfRoll, targetIdRoll: t, targetName: room.players[t].name, targetRoll };
        const diff = selfRoll - targetRoll;
        if (diff === 0) {
          dealDamage(room, actingId, cost, log, actingId);
          dealDamage(room, t, cost, log, actingId);
          log.push('引き分け:お互いコスト分のダメージを受けた');
        } else if (diff > 0) {
          const dmg = ceilDiv((diff * cost) / 6);
          dealDamage(room, t, dmg, log, actingId);
          const manaMove = Math.min(ceilDiv(diff / 2), room.players[t].mana);
          loseMana(room, t, manaMove, log);
          gainMana(room, actingId, manaMove, log);
        } else {
          const dmg = ceilDiv((-diff * cost) / 6);
          dealDamage(room, actingId, dmg, log, actingId);
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
        if (selfSum > targetSum) dealDamage(room, t, selfSum - targetSum, log, actingId);
        else if (targetSum > selfSum) dealDamage(room, actingId, targetSum - selfSum, log, actingId);
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
      const handCap = 2 + alphaSum(actor, 'extraHand');
      for (let i = 0; i < handCap && room.deck.length > 0; i++) actor.hand.push(room.deck.pop());
      log.push(`${actor.name} はライフ・マナをリセットし、手札を入れ替えた`);
      break;
    }
    case 10: { // 反逆(見た目は裏向きカードとして扱うため、効果ログは出さない)
      actor.reflectUntilTurnStart = true;
      actor.pendingRevealCardId = card.instanceId; // 次の自分のターン開始時に公開・マナ3消費
      actor.life = Math.min(actor.life + 1, 999); // 裏向きに出した状況に近づけるため、ライフ+1(初期ライフを超えてもよい)
      break;
    }
    case 11: { // 深淵
      for (let i = 0; i < 2; i++) {
        const blackIdx = room.deck.findIndex((c) => c.isBlack);
        if (blackIdx === -1) break;
        const [drawn] = room.deck.splice(blackIdx, 1);
        log.push(`${actor.name} は深淵から黒いカード「${drawn.name}」を引いた`);
        actor.field.push({ instanceId: drawn.instanceId, no: drawn.no, name: drawn.name, faceUp: true, misfired: false });
        room.blackCardUsage[actingId] = (room.blackCardUsage[actingId] || 0) + 1; // 深淵で使った黒いカードも使用済みとしてカウントする
        const subOpts = { targetId: opts.subTargets ? opts.subTargets[i] : opts.targetId, chosenCost: drawn.baseCost || 3, __nested: true };
        const sub = resolveEffect(room, actingId, drawn, subOpts);
        log.push(...sub.log);
      }
      break;
    }
    case 12: { // 浄化
      for (const p of alivePlayers(room)) {
        const usedCount = room.blackCardUsage[p.id] || 0;
        if (usedCount > 0) dealDamage(room, p.id, usedCount * 2, log, actingId);
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
      const targets = alivePlayers(room);
      const smallPickMax = targets.length >= 3 ? 4 : 3; // 2人以下なら裁判(index3)を除外
      const pick = scale === 'small' ? Math.floor(Math.random() * smallPickMax) : Math.floor(Math.random() * 4);
      if (scale === 'small') {
        if (pick === 0) { log.push('【つむじ風】が発動'); for (const p of targets) dealDamage(room, p.id, p.id === actingId ? 2 : 3, log, actingId); for (const p of targets) loseMana(room, p.id, 2, log); }
        else if (pick === 1) { log.push('【落石】が発動'); for (let i = 0; i < 4; i++) { const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, 2, log, actingId); } }
        else if (pick === 2) { log.push('【混乱】が発動'); const hands = targets.map((p) => p.hand); for (let i = 0; i < targets.length; i++) targets[i].hand = hands[(i + 1) % hands.length]; log.push('全プレイヤーの手札が入れ替わった'); }
        else {
          // 裁判: 全員の投票を待つ必要があるため、ここでは開始の合図だけを出す(実際の集計はサーバー側の投票フローで行う)
          log.push('【裁判】が発動。全員の投票を待っています…');
          extra = { type: 'trial_pending', candidateIds: targets.map((p) => p.id) };
        }
      } else if (scale === 'medium') {
        if (pick === 0) { log.push('【竜巻】が発動'); for (const p of targets) { loseMana(room, p.id, 3, log); dealDamage(room, p.id, p.id === actingId ? 4 : 5, log, actingId); } const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, 3, log, actingId); }
        else if (pick === 1) { log.push('【隕石】が発動'); for (let i = 0; i < 4; i++) { const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, 4, log, actingId); } }
        else if (pick === 2) { log.push('【命水】が発動'); for (const p of targets) healLife(room, p.id, 5, log, null); }
        else { log.push('【疫病】が発動'); const roll = Math.floor(Math.random() * 10) + 1; const dmg = ceilDiv((targets.length * roll) / 3); for (const p of targets) dealDamage(room, p.id, p.id === actingId ? Math.max(0, dmg - 1) : dmg, log, actingId); }
      } else {
        if (pick === 0) { log.push('【テンペスト】が発動'); for (const p of targets) p.life = Math.max(1, Math.min(3, Math.floor(Math.random() * 3) + 1)); log.push('全員のライフが1〜3のいずれかになった'); }
        else if (pick === 1) { log.push('【スターレイン】が発動'); for (let i = 0; i < 10; i++) { const t = targets[Math.floor(Math.random() * targets.length)]; if (t) dealDamage(room, t.id, Math.floor(Math.random() * 3) + 1, log, actingId); } }
        else if (pick === 2) { log.push('【アノマリー】が発動'); room.chaosBlackBias = true; for (const p of targets) { room.deck.push(...p.hand); p.hand = []; } shuffle(room.deck); for (const p of targets) { const upper = 1 + Math.floor(Math.random() * 4); for (let i = 0; i < upper && room.deck.length > 0; i++) p.hand.push(room.deck.pop()); healLife(room, p.id, 7 - p.hand.length, log, p.initialLife); } }
        else { log.push('【ラグナロク】が発動'); for (const p of targets) { const faceDownCount = p.field.filter((f) => !f.faceUp).length; dealDamage(room, p.id, Math.max(0, 12 - faceDownCount), log, actingId); } }
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
  if (Object.keys(lifeBeforeSnapshot).length > 0) {
    const dealtToOthers = Object.keys(room.players).some(
      (id) => id !== actingId && room.players[id] && room.players[id].life < lifeBeforeSnapshot[id]
    );
    if (dealtToOthers) {
      dealDamage(room, actingId, 1, log);
      log.push(`${actor.name} は魔剣の反動を受けた`);
    }
  }

  return { log, extra };
}

// ========== 専用カード(アルファモード): 神罰・博打 ==========
function resolveDivinePunishment(room, actingId, targetId, log) {
  const actor = room.players[actingId];
  const target = room.players[targetId];
  if (!actor || !target || !target.alive) return;
  const blackUsed = room.blackCardUsage ? (room.blackCardUsage[targetId] || 0) : 0;
  const dmg = 3 + Math.floor(blackUsed / 2);
  log.push(`${actor.name} は「神罰」を発動した`);
  dealDamage(room, targetId, dmg, log, actingId);
}

function resolveGamble(room, actingId, log) {
  const actor = room.players[actingId];
  if (!actor) return null;
  const players = alivePlayers(room);
  if (players.length === 0) return null;
  log.push(`${actor.name} は「博打」を発動した`);
  const rolls = {};
  for (const p of players) {
    const selfBonus = p.id === actingId ? 2 : 0;
    rolls[p.id] = Math.min(10, Math.floor(Math.random() * 10) + 1 + selfBonus + alphaSum(p, 'rouletteBonus'));
  }
  const rollList = players.map((p) => `${p.name}:${rolls[p.id]}`).join(' / ');
  log.push(`ルーレット結果: ${rollList}`);

  const avg = players.reduce((sum, p) => sum + rolls[p.id], 0) / players.length;
  // 端数処理をしても合計が必ず0になるよう、最大剰余法で配分する
  const rawDeltas = players.map((p) => ({ id: p.id, raw: rolls[p.id] - avg, floor: Math.floor(rolls[p.id] - avg) }));
  let flooredSum = rawDeltas.reduce((s, d) => s + d.floor, 0);
  let remainder = 0 - flooredSum; // 0に合わせるために配るべき差分(通常0〜players.length-1程度)
  const byFraction = [...rawDeltas].sort((a, b) => (b.raw - b.floor) - (a.raw - a.floor));
  const finalDeltas = {};
  for (const d of rawDeltas) finalDeltas[d.id] = d.floor;
  for (let i = 0; i < byFraction.length && remainder > 0; i++, remainder--) {
    finalDeltas[byFraction[i].id] += 1;
  }
  for (const p of players) {
    const delta = finalDeltas[p.id];
    if (delta === 0) continue;
    if (delta < 0 && p.shielded) {
      log.push(`${p.name} は防御中のため、博打によるマナ減少を受けなかった`);
      continue;
    }
    p.mana += delta; // 博打の効果ではマナが負の値になることもある
    log.push(`${p.name} のマナが ${delta > 0 ? `${delta}増加` : `${-delta}減少`}した(現在 ${p.mana})`);
  }
  return {
    type: 'gambleRoulette',
    actorId: actingId,
    players: players.map((p) => ({ id: p.id, name: p.name, roll: rolls[p.id], delta: finalDeltas[p.id] })),
  };
}

function resolveTrialVotes(room, votes, actingId) {
  // votes: { voterId: targetId }。actingId(混沌の使用者)の1票は2票分として数える
  const log = [];
  const counts = {};
  for (const [voterId, targetId] of Object.entries(votes)) {
    if (!targetId || !room.players[targetId]) continue;
    const weight = voterId === actingId ? 2 : 1;
    counts[targetId] = (counts[targetId] || 0) + weight;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) { log.push('裁判: 有効な投票がなく、何も起こらなかった'); return log; }
  const maxCount = Math.max(...entries.map(([, c]) => c));
  const topTargets = entries.filter(([, c]) => c === maxCount).map(([id]) => id);
  const dmgEach = ceilDiv(7 / topTargets.length);
  for (const id of topTargets) {
    const p = room.players[id];
    if (!p) continue;
    log.push(`裁判の結果、${p.name} が最多票(${maxCount}票)で選ばれた`);
    dealDamage(room, id, dmgEach, log);
  }
  return log;
}

module.exports = {
  CARD_DEFS,
  makeInstance,
  ALPHA_CARDS,
  EXCLUSIVE_CARD_INFO,
  alphaSum,
  hasExclusive,
  applyLifeDelta,
  adjustHandCapAfterAlphaChange,
  resolveDivinePunishment,
  resolveGamble,
  buildDeck,
  shuffle,
  manaRegenAmount,
  MANA_CAP_DISPLAY,
  resolveEffect,
  resolveTrialVotes,
  alivePlayers,
  otherAlivePlayers,
  dealDamage,
};
