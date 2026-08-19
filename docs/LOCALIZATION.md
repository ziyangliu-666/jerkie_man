# Localization Guide — ZIYANG PROTOCOL

English is the **source language**. Chinese is the translation.

This is not a translation project. English copy must read as if the game was
written in English by people who play extraction shooters. Chinese source text
is a *specification of meaning*, never a template to follow word by word.

## 1. Golden rules

1. **Localize the intent, not the words.** If the natural English phrasing has a
   different structure, length, or metaphor than the Chinese, use the English one.
2. **Match the genre.** This is an extraction shooter. Escape from Tarkov,
   Hunt: Showdown, Arena Breakout and Marauders set the vocabulary players
   already know. Use their conventions, not literal renderings.
3. **Terse over polite.** Military-operational register. `Stash full`, not
   `Your stash is currently full`. No `please`, no apologies.
4. **Never invent mechanics.** Copy must match what the code actually does.
   If a stim gives +40% speed for 15s, the text says that, not "greatly boosts speed".
5. **Chinese is not a fallback for English.** Any key missing from `en` is a bug.

## 2. Register and formatting

| Context | Style | Example |
|---|---|---|
| Buttons / tabs | Title Case, short | `Deploy`, `Sell`, `Return to Base` |
| Section headers in HUD | ALL CAPS | `HEALTH`, `STAMINA`, `WEAPON` |
| Body / descriptions | Sentence case | `Restores 40 health over 5 seconds.` |
| Errors | Sentence case, no period, state the blocker | `Stash is full` |
| Empty states | Sentence case | `No items in this category` |

- Numbers stay numerals: `3 items`, not `three items`.
- Use `·` or `|` as separators consistently; never trailing punctuation on labels.
- Avoid contractions in UI chrome (`Cannot`, not `Can't`); contractions are fine
  in tutorial/voice copy where a conversational tone helps.

## 3. Core glossary — use these exact terms

Deviating from this table is a bug. These are the terms players see everywhere.

### Game structure

| Chinese | English | Notes |
|---|---|---|
| 战局 / RAID | **Raid** | One run. `Enter Raid` → the button is `Deploy` |
| 藏身处 / HIDEOUT | **Hideout** | The between-raids hub |
| 进入战局 | **Deploy** | Genre standard for starting a run |
| 撤离 | **Extract** (verb) / **Extraction** (noun) | Extraction point = **Exfil** |
| 撤离点 / 撤离区 | **Extraction Zone** | Short form on HUD: `EXFIL` |
| 撤离成功 | **Extracted** | Result screen badge |
| 阵亡 / 死亡 | **Killed in Action** / **KIA** | KIA on badges |
| 结算 | **Debrief** | The post-raid screen |
| 昵称 / 干员 | **Nickname** | Plain and unambiguous. Do not use "Callsign" or "Operator" — they were tried and rejected |

### Inventory and economy

| Chinese | English | Notes |
|---|---|---|
| 仓库 | **Stash** | Persistent storage. Never "Warehouse" |
| 整备 / 整备道具 | **Loadout** | What you carry into the raid |
| 整备区 | **Loadout** | Same term; the 0/8 capacity area |
| 商店 | **Market** | Never "Shop" |
| 背包 | **Backpack** | |
| 防具 | **Armor** | US spelling throughout |
| 武器 | **Weapon** | |
| 装备 (动词) | **Equip** | |
| 卸下 | **Unequip** | |
| 交换 / 切换武器 | **Swap** | |
| 带入 | **Add to Loadout** | |
| 移回仓库 | **Move to Stash** | |
| 卖出 | **Sell** | |
| 购买 | **Buy** | |
| 金钱 | **Credits** | The currency |
| 余额不足 | **Not enough credits** | |
| 战利品 | **Loot** | |
| 消耗品 | **Consumables** | |
| 材料 | **Materials** | |
| 任务物品 | **Quest Item** | |
| 容量 | **Capacity** | |
| 未装备 | **Empty** | Slot placeholder, not "Not equipped" |
| 拳头 | **Fists** | Default melee |

### Rarity — fixed, do not vary

| Enum | English | Chinese |
|---|---|---|
| COMMON | Common | 普通 |
| RARE | Rare | 稀有 |
| EPIC | Epic | 史诗 |
| LEGENDARY | Legendary | 传说 |

### Combat and HUD

| Chinese | English | Notes |
|---|---|---|
| 生命 / 血量 | **Health** | HUD label `HEALTH` |
| 耐力 | **Stamina** | |
| 状态 | **Status** | Buff/debuff strip |
| 换弹 / 换弹中 | **Reloading** | |
| 弹药 | **Ammo** | |
| 弹匣 | **Magazine** / **Mag** | `Mag` in tight HUD space |
| 减伤 | **Damage Reduction** | |
| 击杀播报 | **Kill Feed** | |
| 近战 | **Melee** | |
| 投掷物 | **Throwable** | |
| 环境伤害 | **Environment** | Kill feed attribution |
| 未知 | **Unknown** | |

### Enemies

| Chinese | English | Notes |
|---|---|---|
| 侦查兵AI | **Scout** | Drop the "AI" suffix — it reads as debug text |
| 狙击手AI | **Sniper** | |
| 重装兵AI | **Heavy** | |
| 野怪AI | **Feral** | |
| 自动哨兵 / 机枪炮塔 | **Sentry Turret** | |
| 自动火炮 | **Autocannon** | |

## 4. Key naming

Dot-separated, lowercase, `area.element.state`:

```
hud.health              ui.btn.deploy           item.medkit.name
hud.stamina             ui.btn.sell             item.medkit.desc
raid.extract.progress   market.empty            rarity.legendary
error.stash.full        debrief.title.success   tutorial.move.body
```

- Item keys derive from the item id: `item.<id>.name` / `item.<id>.desc`.
- Server-sent events: `event.<name>`; errors: `error.<domain>.<reason>`.

## 5. Interpolation and plurals

Placeholders are named, never positional — English word order differs from Chinese:

```ts
t('event.autoEquip', { item: 'AKM' })      // "Auto-equipped AKM"
t('market.bought', { count: 3, item: 'Bandage' })
```

For countable nouns provide both forms:

```ts
'loot.recovered_one':   '{count} item recovered',
'loot.recovered_other': '{count} items recovered',
```

Call `t()` with a `count` param and it resolves the suffix automatically.
Chinese uses the `_other` form for both — that is expected, not a bug.

## 6. Text expansion

English is often longer than Chinese (a 4-character Chinese label can become
20+ characters). For canvas-drawn text and fixed-width HUD elements:

- Prefer the shortest natural word (`Mag`, `EXFIL`, `KIA`).
- Never abbreviate into something a player would not recognise.
- Flag any string that must fit a fixed box so layout can be checked.

## 7. Do not translate

- Player-entered callsigns
- Numbers, timers, coordinates
- Console/debug output and `log()` calls — server logs stay English
- Internal ids, map template ids, enum values
