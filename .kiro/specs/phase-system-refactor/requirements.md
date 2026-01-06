# Requirements Document: Phase System Refactor

## Introduction

当前游戏的phase系统（阶段状态机）存在严重的混乱问题：
- 状态分散在客户端和服务端多处
- 状态同步逻辑不清晰
- 页面刷新和重连处理混乱
- UI更新逻辑分散且难以维护

本需求文档旨在重构整个phase系统，建立清晰的状态管理和同步机制。

## Glossary

- **Phase**: 游戏阶段，包括 NAME（输入昵称）、HIDEOUT（藏身处）、RAID（战局中）、RESULT（结算中）
- **Client**: 客户端（浏览器端）
- **Server**: 服务端（Node.js）
- **Profile**: 玩家档案，包含持久化数据（金钱、仓库、装备等）
- **State_Machine**: 状态机，管理phase之间的转换
- **Reconnect**: 重连，指客户端断线后重新连接
- **Refresh**: 刷新，指用户刷新浏览器页面

## Requirements

### Requirement 1: 单一真相来源

**User Story:** 作为开发者，我希望phase状态有唯一的权威来源，这样可以避免客户端和服务端状态不一致的问题。

#### Acceptance Criteria

1. THE Server SHALL 将 phase 状态持久化到 Profile 中
2. THE Client SHALL 始终使用服务端下发的 phase 状态
3. WHEN 客户端连接成功 THEN THE Server SHALL 立即发送包含 phase 的 Profile 消息
4. THE Client SHALL NOT 在未收到服务端 phase 之前显示任何游戏界面

### Requirement 2: 清晰的状态转换

**User Story:** 作为开发者，我希望phase之间的转换逻辑清晰且集中管理，这样可以避免状态转换的混乱。

#### Acceptance Criteria

1. THE System SHALL 定义明确的 phase 转换规则（NAME → HIDEOUT → RAID → RESULT → HIDEOUT）
2. WHEN phase 转换发生 THEN THE Server SHALL 更新 Profile 中的 phase 并发送给客户端
3. THE Client SHALL 仅在收到服务端 phase 更新后才更新本地 phase
4. THE System SHALL 记录所有 phase 转换日志，便于调试

### Requirement 3: 页面刷新处理

**User Story:** 作为玩家，我希望刷新页面后能正确恢复到之前的游戏状态，而不会出现状态错乱。

#### Acceptance Criteria

1. WHEN 用户刷新页面 THEN THE Client SHALL 重新连接服务端并请求当前 phase
2. WHEN 客户端重连 THEN THE Server SHALL 根据 Profile 中的 phase 返回正确的状态
3. IF Profile.phase 为 RAID 且玩家实体存在 THEN THE Server SHALL 允许玩家继续游戏
4. IF Profile.phase 为 RAID 但玩家实体不存在 THEN THE Server SHALL 将 phase 重置为 HIDEOUT
5. IF Profile.phase 为 RESULT THEN THE Server SHALL 将 phase 重置为 HIDEOUT（结算是临时状态）

### Requirement 4: 客户端-服务端通信

**User Story:** 作为开发者，我希望客户端和服务端之间的phase通信协议清晰且可靠，这样可以避免状态同步问题。

#### Acceptance Criteria

1. THE Server SHALL 在 S2C_PROFILE 消息中包含 phase 字段
2. THE Client SHALL 在收到 S2C_PROFILE 后立即更新本地 phase
3. WHEN phase 转换发生 THEN THE Server SHALL 发送新的 S2C_PROFILE 消息
4. THE Client SHALL NOT 主动修改 phase，除非收到服务端消息

### Requirement 5: UI状态管理

**User Story:** 作为开发者，我希望UI的显示/隐藏逻辑集中管理，这样可以避免UI状态混乱。

#### Acceptance Criteria

1. THE Client SHALL 定义单一的 updatePhaseUI 函数来管理所有UI状态
2. WHEN phase 改变 THEN THE Client SHALL 调用 updatePhaseUI 更新所有相关UI
3. THE updatePhaseUI 函数 SHALL 根据 phase 显示/隐藏对应的UI元素
4. THE Client SHALL 清理不再需要的状态（如非RAID时清理子弹轨迹）

### Requirement 6: 错误处理和边界情况

**User Story:** 作为开发者，我希望系统能正确处理各种边界情况和错误，这样可以提高系统的健壮性。

#### Acceptance Criteria

1. IF 客户端在 phase 未接收时尝试操作 THEN THE Client SHALL 忽略操作并记录警告
2. IF 服务端检测到 phase 不一致 THEN THE Server SHALL 强制同步正确的 phase
3. WHEN 玩家在 RAID 中断线超时 THEN THE Server SHALL 将 phase 重置为 HIDEOUT
4. WHEN 玩家死亡或撤离 THEN THE Server SHALL 将 phase 更新为 RESULT，然后自动转为 HIDEOUT

### Requirement 7: 调试和可观测性

**User Story:** 作为开发者，我希望能轻松调试phase相关的问题，这样可以快速定位和修复bug。

#### Acceptance Criteria

1. THE System SHALL 在所有 phase 转换时记录详细日志
2. THE Client SHALL 在 HUD 中显示当前 phase（已实现）
3. THE System SHALL 记录 phase 不一致的情况并发出警告
4. THE System SHALL 提供管理员命令来查看和修改 phase（仅开发环境）
