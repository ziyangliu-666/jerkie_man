# Design Document: Phase System Refactor

## Overview

本设计文档描述了如何重构游戏的phase系统，建立清晰的状态管理架构。核心思想是：

- **服务端权威**：phase状态由服务端持久化和管理
- **单向数据流**：客户端只读phase，所有修改通过服务端
- **集中管理**：状态转换和UI更新逻辑集中在少数几个函数中
- **清晰的生命周期**：明确定义连接、刷新、重连的处理流程

## Architecture

### 状态机设计

```
┌─────────┐
│  START  │
└────┬────┘
     │
     ▼
┌─────────┐  设置昵称   ┌──────────┐  进入战局   ┌──────┐
│  NAME   │──────────▶│ HIDEOUT  │──────────▶│ RAID │
└─────────┘            └──────────┘            └───┬──┘
                            ▲                      │
                            │                      │ 死亡/撤离
                            │                      ▼
                            │                 ┌────────┐
                            └─────────────────│ RESULT │
                                              └────────┘
                                              (临时状态，自动转HIDEOUT)
```

### 组件架构

```
┌─────────────────────────────────────────────────────────┐
│                        Client                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │  PhaseManager (新增)                              │  │
│  │  - currentPhase: Phase | null                     │  │
│  │  - updatePhase(phase: Phase): void                │  │
│  │  - getPhase(): Phase | null                       │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                               │
│                          ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │  UIManager (新增)                                 │  │
│  │  - updatePhaseUI(phase: Phase): void              │  │
│  │  - showNameModal(): void                          │  │
│  │  - showHideoutUI(): void                          │  │
│  │  - showRaidUI(): void                             │  │
│  │  - showResultUI(): void                           │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                               │
│                          ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Network                                          │  │
│  │  - onProfile(profile: S2C_PROFILE): void          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          │ WebSocket
                          ▼
┌─────────────────────────────────────────────────────────┐
│                        Server                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │  ProfileManager                                   │  │
│  │  - profile.phase: Phase                           │  │
│  │  - setPhase(accountId, phase): void               │  │
│  │  - getPhase(accountId): Phase                     │  │
│  └──────────────────────────────────────────────────┘  │
│                          │                               │
│                          ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │  PhaseTransitionHandler (新增)                    │  │
│  │  - handleSetName(accountId): void                 │  │
│  │  - handleEnterRaid(accountId): void               │  │
│  │  - handleExtract(accountId): void                 │  │
│  │  - handleDeath(accountId): void                   │  │
│  │  - handleReconnect(accountId): Phase              │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Client: PhaseManager

**职责**：管理客户端的phase状态，提供统一的访问接口

```typescript
// client/src/phaseManager.ts
export type Phase = 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT';

export class PhaseManager {
  private currentPhase: Phase | null = null;
  private listeners: Array<(phase: Phase) => void> = [];

  /**
   * 更新phase（仅由服务端消息触发）
   */
  updatePhase(phase: Phase): void {
    const oldPhase = this.currentPhase;
    this.currentPhase = phase;
    
    console.log(`[PhaseManager] Phase transition: ${oldPhase} -> ${phase}`);
    
    // 通知所有监听器
    this.listeners.forEach(listener => listener(phase));
  }

  /**
   * 获取当前phase
   */
  getPhase(): Phase | null {
    return this.currentPhase;
  }

  /**
   * 检查是否在指定phase
   */
  isPhase(phase: Phase): boolean {
    return this.currentPhase === phase;
  }

  /**
   * 添加phase变化监听器
   */
  addListener(listener: (phase: Phase) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 移除phase变化监听器
   */
  removeListener(listener: (phase: Phase) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }
}
```

### 2. Client: UIManager

**职责**：根据phase管理所有UI的显示/隐藏

```typescript
// client/src/uiManager.ts
import type { Phase } from './phaseManager.js';

export class UIManager {
  private nameModal: HTMLElement | null = null;
  private hideoutUI: HTMLElement | null = null;
  private raidEquipment: HTMLElement | null = null;
  private resultUI: HTMLElement | null = null;

  constructor() {
    // 延迟获取DOM元素，确保DOM已加载
    this.initElements();
  }

  private initElements(): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.getElements());
    } else {
      this.getElements();
    }
  }

  private getElements(): void {
    this.nameModal = document.getElementById('nameModal');
    this.hideoutUI = document.getElementById('hideoutUI');
    this.raidEquipment = document.getElementById('raidEquipment');
    this.resultUI = document.getElementById('resultUI');
  }

  /**
   * 根据phase更新所有UI
   */
  updatePhaseUI(phase: Phase): void {
    console.log(`[UIManager] Updating UI for phase: ${phase}`);

    // 确保元素已获取
    if (!this.nameModal || !this.hideoutUI) {
      this.getElements();
    }

    // 隐藏所有UI
    this.hideAll();

    // 根据phase显示对应UI
    switch (phase) {
      case 'NAME':
        this.showNameModal();
        break;
      case 'HIDEOUT':
        this.showHideoutUI();
        break;
      case 'RAID':
        this.showRaidUI();
        break;
      case 'RESULT':
        this.showResultUI();
        break;
    }
  }

  private hideAll(): void {
    if (this.nameModal) this.nameModal.style.display = 'none';
    if (this.hideoutUI) this.hideoutUI.style.display = 'none';
    if (this.raidEquipment) this.raidEquipment.style.display = 'none';
    if (this.resultUI) this.resultUI.style.display = 'none';
  }

  private showNameModal(): void {
    if (this.nameModal) {
      this.nameModal.style.display = 'flex';
    }
  }

  private showHideoutUI(): void {
    if (this.hideoutUI) {
      this.hideoutUI.style.display = 'flex';
    }
  }

  private showRaidUI(): void {
    if (this.raidEquipment) {
      this.raidEquipment.style.display = 'block';
    }
  }

  private showResultUI(): void {
    if (this.resultUI) {
      this.resultUI.style.display = 'flex';
    }
  }
}
```

### 3. Client: 主循环集成

**职责**：在主循环中集成PhaseManager和UIManager

```typescript
// client/src/main.ts (重构后)
import { PhaseManager } from './phaseManager.js';
import { UIManager } from './uiManager.js';

// 创建管理器实例
const phaseManager = new PhaseManager();
const uiManager = new UIManager();

// 监听phase变化，自动更新UI
phaseManager.addListener((phase) => {
  uiManager.updatePhaseUI(phase);
  
  // 清理非RAID状态的数据
  if (phase !== 'RAID') {
    predictedLocalPlayer = null;
    renderLocalPlayer = null;
    bulletTracks.clear();
  }
});

// 处理服务端Profile消息
network.onProfile = (profile) => {
  // 更新phase（触发UI更新）
  phaseManager.updatePhase(profile.phase);
  
  // 更新其他profile数据
  playerProfile = profile;
  localAccountId = profile.accountId;
};

// 游戏循环中检查phase
function gameLoop() {
  const phase = phaseManager.getPhase();
  
  // 只在RAID阶段处理游戏逻辑
  if (phase === 'RAID') {
    // 处理输入、预测、渲染等
  }
  
  requestAnimationFrame(gameLoop);
}
```

### 4. Server: PhaseTransitionHandler

**职责**：处理所有phase转换逻辑

```typescript
// server/src/phaseTransition.ts
import type { ProfileManager } from './profile.js';
import type { Room } from './room.js';
import { log } from './logger.js';

export class PhaseTransitionHandler {
  constructor(
    private profileManager: ProfileManager,
    private room: Room
  ) {}

  /**
   * 处理设置昵称（NAME -> HIDEOUT）
   */
  handleSetName(accountId: string, name: string): void {
    const profile = this.profileManager.getProfileData(accountId);
    
    if (profile.phase !== 'NAME') {
      log('PHASE_TRANSITION_ERROR', {
        accountId: accountId.substring(0, 8),
        currentPhase: profile.phase,
        expectedPhase: 'NAME',
        action: 'setName',
      });
      return;
    }

    // 更新昵称和phase
    this.profileManager.setDisplayName(accountId, name);
    this.profileManager.setPhase(accountId, 'HIDEOUT');

    log('PHASE_TRANSITION', {
      accountId: accountId.substring(0, 8),
      from: 'NAME',
      to: 'HIDEOUT',
      trigger: 'setName',
    });
  }

  /**
   * 处理进入战局（HIDEOUT -> RAID）
   */
  handleEnterRaid(accountId: string): void {
    const profile = this.profileManager.getProfileData(accountId);
    
    if (profile.phase !== 'HIDEOUT') {
      log('PHASE_TRANSITION_ERROR', {
        accountId: accountId.substring(0, 8),
        currentPhase: profile.phase,
        expectedPhase: 'HIDEOUT',
        action: 'enterRaid',
      });
      return;
    }

    // 更新phase
    this.profileManager.setPhase(accountId, 'RAID');

    log('PHASE_TRANSITION', {
      accountId: accountId.substring(0, 8),
      from: 'HIDEOUT',
      to: 'RAID',
      trigger: 'enterRaid',
    });
  }

  /**
   * 处理撤离（RAID -> RESULT -> HIDEOUT）
   */
  handleExtract(accountId: string): void {
    const profile = this.profileManager.getProfileData(accountId);
    
    if (profile.phase !== 'RAID') {
      log('PHASE_TRANSITION_ERROR', {
        accountId: accountId.substring(0, 8),
        currentPhase: profile.phase,
        expectedPhase: 'RAID',
        action: 'extract',
      });
      return;
    }

    // 先转到RESULT（临时状态）
    this.profileManager.setPhase(accountId, 'RESULT');

    log('PHASE_TRANSITION', {
      accountId: accountId.substring(0, 8),
      from: 'RAID',
      to: 'RESULT',
      trigger: 'extract',
    });

    // 延迟转到HIDEOUT（给客户端时间显示结果）
    // 注意：实际实现中，应该由客户端点击"继续"按钮触发
  }

  /**
   * 处理死亡（RAID -> RESULT -> HIDEOUT）
   */
  handleDeath(accountId: string): void {
    const profile = this.profileManager.getProfileData(accountId);
    
    if (profile.phase !== 'RAID') {
      log('PHASE_TRANSITION_ERROR', {
        accountId: accountId.substring(0, 8),
        currentPhase: profile.phase,
        expectedPhase: 'RAID',
        action: 'death',
      });
      return;
    }

    // 先转到RESULT（临时状态）
    this.profileManager.setPhase(accountId, 'RESULT');

    log('PHASE_TRANSITION', {
      accountId: accountId.substring(0, 8),
      from: 'RAID',
      to: 'RESULT',
      trigger: 'death',
    });
  }

  /**
   * 处理重连/刷新（根据当前phase决定行为）
   * 
   * 刷新场景处理：
   * 1. NAME阶段刷新 -> 保持NAME（用户还没设置昵称）
   * 2. HIDEOUT阶段刷新 -> 保持HIDEOUT（用户在仓库/整备界面）
   * 3. RAID阶段刷新 -> 如果玩家实体存活，保持RAID；否则转HIDEOUT
   * 4. RESULT阶段刷新 -> 转HIDEOUT（结算是临时状态）
   */
  handleReconnect(accountId: string, playerId: string | null): Phase {
    const profile = this.profileManager.getProfileData(accountId);
    const player = playerId ? this.room.getPlayer(playerId) : null;

    log('PHASE_RECONNECT', {
      accountId: accountId.substring(0, 8),
      playerId: playerId?.substring(0, 15) ?? 'N/A',
      profilePhase: profile.phase,
      playerExists: !!player,
      playerStatus: player?.status ?? 'N/A',
    });

    // 场景1: NAME阶段刷新 -> 保持NAME
    if (profile.phase === 'NAME') {
      log('PHASE_RECONNECT_NAME', {
        accountId: accountId.substring(0, 8),
        action: 'keep_NAME',
      });
      return 'NAME';
    }

    // 场景2: HIDEOUT阶段刷新 -> 保持HIDEOUT
    if (profile.phase === 'HIDEOUT') {
      log('PHASE_RECONNECT_HIDEOUT', {
        accountId: accountId.substring(0, 8),
        action: 'keep_HIDEOUT',
      });
      return 'HIDEOUT';
    }

    // 场景3: RAID阶段刷新
    if (profile.phase === 'RAID') {
      // 如果玩家实体存在且存活，允许继续游戏
      if (player && player.status === 'ALIVE') {
        log('PHASE_RECONNECT_RAID_CONTINUE', {
          accountId: accountId.substring(0, 8),
          playerId: playerId?.substring(0, 15),
          action: 'keep_RAID',
        });
        return 'RAID';
      }
      
      // 玩家实体不存在或已死亡，转到HIDEOUT
      this.profileManager.setPhase(accountId, 'HIDEOUT');
      log('PHASE_TRANSITION', {
        accountId: accountId.substring(0, 8),
        from: 'RAID',
        to: 'HIDEOUT',
        trigger: 'reconnect_raid_cleanup',
        reason: player ? 'player_dead' : 'player_not_found',
      });
      return 'HIDEOUT';
    }

    // 场景4: RESULT阶段刷新 -> 转HIDEOUT（结算是临时状态）
    if (profile.phase === 'RESULT') {
      this.profileManager.setPhase(accountId, 'HIDEOUT');
      log('PHASE_TRANSITION', {
        accountId: accountId.substring(0, 8),
        from: 'RESULT',
        to: 'HIDEOUT',
        trigger: 'reconnect_result_cleanup',
      });
      return 'HIDEOUT';
    }

    // 不应该到达这里，但为了安全返回HIDEOUT
    log('PHASE_RECONNECT_FALLBACK', {
      accountId: accountId.substring(0, 8),
      profilePhase: profile.phase,
      action: 'fallback_to_HIDEOUT',
    });
    return 'HIDEOUT';
  }
}
```

### 5. Server: ProfileManager 扩展

**职责**：添加phase管理方法

```typescript
// server/src/profile.ts (扩展)
export class ProfileManager {
  // ... 现有代码 ...

  /**
   * 设置phase
   */
  setPhase(accountId: string, phase: Phase): void {
    const profile = this.getProfileData(accountId);
    profile.phase = phase;
    this.saveProfile(accountId);
    
    log('PROFILE_PHASE_UPDATE', {
      accountId: accountId.substring(0, 8),
      phase,
    });
  }

  /**
   * 获取phase
   */
  getPhase(accountId: string): Phase {
    const profile = this.getProfileData(accountId);
    return profile.phase;
  }
}
```

## Data Models

### Phase Type

```typescript
// shared/src/types.ts
export type Phase = 'NAME' | 'HIDEOUT' | 'RAID' | 'RESULT';
```

### Profile Schema (扩展)

```typescript
// shared/src/protocol.ts
export const S2C_PROFILE_SCHEMA = z.object({
  type: z.literal('S2C_PROFILE'),
  accountId: z.string(),
  displayName: z.string().nullable(),
  phase: z.enum(['NAME', 'HIDEOUT', 'RAID', 'RESULT']), // 必需字段
  money: z.number().int().nonnegative(),
  stash: z.array(ITEM_INSTANCE_SCHEMA),
  prep: z.array(ITEM_INSTANCE_SCHEMA).optional(),
  bagCap: z.number().int().positive(),
  equipment: PLAYER_EQUIPMENT_SCHEMA,
});
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Phase单一真相来源

*For any* 客户端连接，服务端发送的 phase 应该是 Profile 中持久化的 phase，客户端的 phase 应该始终等于最后一次收到的服务端 phase

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Phase转换合法性

*For any* phase 转换，转换后的 phase 应该符合状态机规则（NAME -> HIDEOUT -> RAID -> RESULT -> HIDEOUT），不应该出现非法转换

**Validates: Requirements 2.1, 2.2**

### Property 3: 刷新后状态一致性

*For any* 页面刷新操作和任何phase状态（NAME/HIDEOUT/RAID/RESULT），重连后客户端的phase应该符合以下规则：
- NAME刷新 -> 保持NAME
- HIDEOUT刷新 -> 保持HIDEOUT（无论在哪个tab）
- RAID刷新且玩家存活 -> 保持RAID
- RAID刷新但玩家已死亡 -> 转HIDEOUT
- RESULT刷新 -> 转HIDEOUT

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 4: UI状态一致性

*For any* phase 值，UI 的显示状态应该与 phase 对应（NAME显示昵称输入，HIDEOUT显示整备界面，RAID显示游戏界面，RESULT显示结算界面）

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 5: Phase消息完整性

*For any* S2C_PROFILE 消息，必须包含有效的 phase 字段，客户端收到后必须更新本地 phase

**Validates: Requirements 4.1, 4.2, 4.3**

## Error Handling

### 1. Phase未接收时的操作

**场景**：客户端在收到服务端phase之前尝试操作

**处理**：
- 所有需要phase的操作检查 `phaseManager.getPhase() !== null`
- 如果phase为null，记录警告并忽略操作
- 显示加载提示，等待服务端响应

### 2. Phase不一致检测

**场景**：服务端检测到客户端phase与Profile不一致

**处理**：
- 服务端强制发送正确的S2C_PROFILE消息
- 记录详细的不一致日志
- 客户端收到后立即同步

### 3. RAID中断线超时

**场景**：玩家在RAID中断线超过一定时间

**处理**：
- 服务端清理玩家实体
- 将Profile.phase重置为HIDEOUT
- 玩家重连时收到HIDEOUT状态

### 4. 非法Phase转换

**场景**：尝试进行非法的phase转换（如NAME直接到RAID）

**处理**：
- PhaseTransitionHandler检查当前phase
- 如果不符合预期，记录错误并拒绝转换
- 返回错误消息给客户端

## Testing Strategy

### Unit Tests

**测试目标**：
- PhaseManager的基本功能（updatePhase, getPhase, listeners）
- UIManager的UI显示/隐藏逻辑
- PhaseTransitionHandler的各个转换方法

**测试框架**：使用项目现有的测试框架（如Jest或Vitest）

**示例测试**：
```typescript
describe('PhaseManager', () => {
  it('should update phase and notify listeners', () => {
    const manager = new PhaseManager();
    let notified = false;
    
    manager.addListener((phase) => {
      expect(phase).toBe('HIDEOUT');
      notified = true;
    });
    
    manager.updatePhase('HIDEOUT');
    expect(manager.getPhase()).toBe('HIDEOUT');
    expect(notified).toBe(true);
  });
});
```

### Property-Based Tests

**测试框架**：使用fast-check（JavaScript/TypeScript的property-based testing库）

**配置**：每个property test运行至少100次迭代

**Property Test 1: Phase单一真相来源**
```typescript
// Feature: phase-system-refactor, Property 1: Phase单一真相来源
it('server phase should always match profile phase', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('NAME', 'HIDEOUT', 'RAID', 'RESULT'),
      (phase) => {
        const profileManager = new ProfileManager();
        const accountId = 'test-account';
        
        profileManager.setPhase(accountId, phase);
        const retrievedPhase = profileManager.getPhase(accountId);
        
        return retrievedPhase === phase;
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property Test 2: Phase转换合法性**
```typescript
// Feature: phase-system-refactor, Property 2: Phase转换合法性
it('phase transitions should follow state machine rules', () => {
  const validTransitions = {
    'NAME': ['HIDEOUT'],
    'HIDEOUT': ['RAID'],
    'RAID': ['RESULT'],
    'RESULT': ['HIDEOUT'],
  };
  
  fc.assert(
    fc.property(
      fc.constantFrom('NAME', 'HIDEOUT', 'RAID', 'RESULT'),
      fc.constantFrom('NAME', 'HIDEOUT', 'RAID', 'RESULT'),
      (fromPhase, toPhase) => {
        const isValid = validTransitions[fromPhase].includes(toPhase);
        
        // 如果转换合法，PhaseTransitionHandler应该允许
        // 如果转换非法，应该拒绝并记录错误
        
        return true; // 实际测试中需要调用handler并检查结果
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property Test 3: UI状态一致性**
```typescript
// Feature: phase-system-refactor, Property 4: UI状态一致性
it('UI should match phase state', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('NAME', 'HIDEOUT', 'RAID', 'RESULT'),
      (phase) => {
        const uiManager = new UIManager();
        uiManager.updatePhaseUI(phase);
        
        // 检查对应的UI元素是否显示
        // 这需要mock DOM元素
        
        return true; // 实际测试中需要检查DOM状态
      }
    ),
    { numRuns: 100 }
  );
});
```

### Integration Tests

**测试目标**：
- 完整的phase转换流程（客户端 -> 服务端 -> 客户端）
- 页面刷新和重连场景
- 多个phase转换的连续操作

**测试环境**：
- 启动测试服务器
- 使用WebSocket客户端模拟真实连接
- 验证消息序列和状态变化

### Manual Testing Checklist

1. **初次进入**：
   - [ ] 显示NAME modal
   - [ ] 输入昵称后转到HIDEOUT
   - [ ] HIDEOUT UI正确显示

2. **进入战局**：
   - [ ] 点击"进入战局"后转到RAID
   - [ ] RAID UI正确显示
   - [ ] 游戏逻辑正常运行

3. **撤离**：
   - [ ] 撤离成功后转到RESULT
   - [ ] RESULT UI显示正确信息
   - [ ] 点击"继续"后转到HIDEOUT

4. **死亡**：
   - [ ] 死亡后转到RESULT
   - [ ] RESULT UI显示死亡信息
   - [ ] 点击"继续"后转到HIDEOUT

5. **刷新页面 - 所有场景**：
   - [ ] 在NAME modal刷新 -> 保持NAME，重新显示昵称输入
   - [ ] 在HIDEOUT仓库tab刷新 -> 保持HIDEOUT，显示仓库界面
   - [ ] 在HIDEOUT商店tab刷新 -> 保持HIDEOUT，显示商店界面
   - [ ] 在HIDEOUT装备tab刷新 -> 保持HIDEOUT，显示装备界面
   - [ ] 在RAID游戏中刷新（玩家存活）-> 保持RAID，继续游戏
   - [ ] 在RAID游戏中刷新（玩家已死亡）-> 转到HIDEOUT
   - [ ] 在RESULT结算页面刷新 -> 转到HIDEOUT
   - [ ] 在RAID背包打开时刷新 -> 保持RAID，背包状态可能重置

6. **断线重连 - 所有场景**：
   - [ ] NAME中断线 -> 重连后保持NAME
   - [ ] HIDEOUT中断线 -> 重连后保持HIDEOUT
   - [ ] RAID中短暂断线（玩家存活）-> 重连后继续RAID
   - [ ] RAID中长时间断线（玩家被清理）-> 重连后转到HIDEOUT
   - [ ] RESULT中断线 -> 重连后转到HIDEOUT

7. **边界情况**：
   - [ ] 快速刷新多次 -> 状态保持一致
   - [ ] 在phase转换过程中刷新 -> 使用服务端最新状态
   - [ ] 多个标签页同时打开 -> 每个标签页独立管理phase
   - [ ] 网络延迟时刷新 -> 等待服务端响应后再显示UI

## Implementation Notes

### 迁移策略

1. **第一阶段**：创建新的PhaseManager和UIManager类
   - 不影响现有代码
   - 可以并行开发和测试

2. **第二阶段**：在main.ts中集成新的管理器
   - 逐步替换分散的phase检查
   - 保留旧代码作为fallback

3. **第三阶段**：重构服务端phase处理
   - 创建PhaseTransitionHandler
   - 替换分散的phase更新逻辑

4. **第四阶段**：清理旧代码
   - 删除分散的phase变量和检查
   - 统一使用新的管理器

### 向后兼容性

- 保持S2C_PROFILE消息格式不变
- 旧客户端仍然可以接收phase字段
- 新客户端使用PhaseManager处理

### 性能考虑

- PhaseManager是轻量级的，不会影响性能
- UI更新只在phase变化时触发，不是每帧
- 避免在游戏循环中频繁检查phase

### 调试工具

- 在HUD中显示当前phase（已实现）
- 添加phase转换历史记录
- 提供管理员命令强制修改phase（仅开发环境）
