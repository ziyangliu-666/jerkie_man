# Implementation Plan: Phase System Refactor

## Overview

本实现计划将phase系统重构分为4个主要阶段：
1. 创建新的管理器类（客户端和服务端）
2. 集成新管理器到现有代码
3. 迁移现有逻辑到新管理器
4. 清理旧代码和测试

每个阶段都包含增量的、可测试的步骤，确保系统在重构过程中保持稳定。

## Tasks

- [ ] 1. 创建客户端PhaseManager
  - 创建 `client/src/phaseManager.ts` 文件
  - 实现 PhaseManager 类（updatePhase, getPhase, isPhase, listeners）
  - 导出 Phase 类型
  - _Requirements: 1.2, 2.3, 4.4_

- [ ]* 1.1 为PhaseManager编写单元测试
  - 测试 updatePhase 方法
  - 测试 getPhase 方法
  - 测试 listener 机制
  - _Requirements: 1.2, 2.3_

- [ ] 2. 创建客户端UIManager
  - 创建 `client/src/uiManager.ts` 文件
  - 实现 UIManager 类（updatePhaseUI, showXXX, hideAll）
  - 处理DOM元素延迟加载
  - _Requirements: 5.1, 5.2, 5.3_

- [ ]* 2.1 为UIManager编写单元测试
  - Mock DOM元素
  - 测试 updatePhaseUI 方法
  - 测试各个 showXXX 方法
  - _Requirements: 5.1, 5.2, 5.3_

- [ ] 3. 创建服务端PhaseTransitionHandler
  - 创建 `server/src/phaseTransition.ts` 文件
  - 实现 PhaseTransitionHandler 类
  - 实现 handleSetName 方法
  - 实现 handleEnterRaid 方法
  - 实现 handleExtract 方法
  - 实现 handleDeath 方法
  - 实现 handleReconnect 方法（处理所有刷新场景）
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ]* 3.1 为PhaseTransitionHandler编写单元测试
  - 测试 handleSetName（NAME -> HIDEOUT）
  - 测试 handleEnterRaid（HIDEOUT -> RAID）
  - 测试 handleExtract（RAID -> RESULT）
  - 测试 handleDeath（RAID -> RESULT）
  - 测试 handleReconnect 的所有场景
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. 扩展服务端ProfileManager
  - 在 `server/src/profile.ts` 中添加 setPhase 方法
  - 在 `server/src/profile.ts` 中添加 getPhase 方法
  - 确保 phase 持久化到 JSON 文件
  - _Requirements: 1.1_

- [ ]* 4.1 为ProfileManager的phase方法编写单元测试
  - 测试 setPhase 方法
  - 测试 getPhase 方法
  - 测试 phase 持久化
  - _Requirements: 1.1_

- [ ] 5. 在客户端main.ts中集成PhaseManager和UIManager
  - 导入 PhaseManager 和 UIManager
  - 创建管理器实例
  - 添加 phase 变化监听器
  - 在监听器中调用 updatePhaseUI
  - 在监听器中清理非RAID状态的数据
  - _Requirements: 1.2, 5.1, 5.2, 5.3, 5.4_

- [ ] 6. 更新客户端network.onProfile处理
  - 在 onProfile 回调中调用 phaseManager.updatePhase
  - 移除旧的 currentPhase 直接赋值
  - 确保 phase 更新触发 UI 更新
  - _Requirements: 1.2, 1.3, 4.2_

- [ ] 7. 在服务端main.ts中集成PhaseTransitionHandler
  - 导入 PhaseTransitionHandler
  - 在 Room 创建时初始化 PhaseTransitionHandler
  - 将 PhaseTransitionHandler 实例传递给需要的地方
  - _Requirements: 2.1, 2.2_

- [ ] 8. 迁移服务端C2S_SET_NAME处理
  - 使用 phaseTransitionHandler.handleSetName
  - 移除旧的 phase 更新逻辑
  - 发送更新后的 Profile 给客户端
  - _Requirements: 2.1, 2.2_

- [ ] 9. 迁移服务端C2S_ENTER_RAID处理
  - 使用 phaseTransitionHandler.handleEnterRaid
  - 移除旧的 phase 更新逻辑
  - 发送更新后的 Profile 给客户端
  - _Requirements: 2.1, 2.2_

- [ ] 10. 迁移服务端撤离处理
  - 在 handlePlayerExtract 中使用 phaseTransitionHandler.handleExtract
  - 移除旧的 phase 更新逻辑
  - 确保发送 S2C_RAID_RESULT 后更新 phase
  - _Requirements: 2.1, 2.2, 6.4_

- [ ] 11. 迁移服务端死亡处理
  - 在 handlePlayerDeath 中使用 phaseTransitionHandler.handleDeath
  - 移除旧的 phase 更新逻辑
  - 确保发送 S2C_RAID_RESULT 后更新 phase
  - _Requirements: 2.1, 2.2, 6.4_

- [ ] 12. 迁移服务端重连处理
  - 在 C2S_HELLO 处理中使用 phaseTransitionHandler.handleReconnect
  - 处理所有刷新场景（NAME/HIDEOUT/RAID/RESULT）
  - 根据返回的 phase 发送正确的 Profile
  - 移除旧的重连逻辑
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 13. 更新客户端游戏循环中的phase检查
  - 使用 phaseManager.isPhase('RAID') 替代 currentPhase === 'RAID'
  - 更新所有需要检查 phase 的地方
  - 确保 phase 为 null 时的正确处理
  - _Requirements: 1.2, 6.1_

- [ ] 14. 添加phase转换日志
  - 在 PhaseTransitionHandler 的所有方法中添加详细日志
  - 在客户端 PhaseManager 中添加 phase 变化日志
  - 确保日志包含 accountId、playerId、旧phase、新phase、触发原因
  - _Requirements: 2.4, 7.1, 7.3_

- [ ] 15. Checkpoint - 基本功能测试
  - 测试初次进入（NAME -> HIDEOUT）
  - 测试进入战局（HIDEOUT -> RAID）
  - 测试撤离（RAID -> RESULT -> HIDEOUT）
  - 测试死亡（RAID -> RESULT -> HIDEOUT）
  - 确保所有基本流程正常工作
  - _Requirements: 所有_

- [ ]* 16. 编写Property Test 1: Phase单一真相来源
  - **Property 1: Phase单一真相来源**
  - **Validates: Requirements 1.1, 1.2, 1.3**
  - 使用 fast-check 生成随机 phase
  - 验证 ProfileManager.setPhase 和 getPhase 的一致性
  - 运行至少100次迭代

- [ ]* 17. 编写Property Test 2: Phase转换合法性
  - **Property 2: Phase转换合法性**
  - **Validates: Requirements 2.1, 2.2**
  - 定义合法转换规则
  - 使用 fast-check 生成随机转换序列
  - 验证 PhaseTransitionHandler 拒绝非法转换

- [ ]* 18. 编写Property Test 3: 刷新后状态一致性
  - **Property 3: 刷新后状态一致性**
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  - 使用 fast-check 生成随机 phase 和玩家状态
  - 验证 handleReconnect 返回正确的 phase
  - 测试所有刷新场景

- [ ]* 19. 编写Property Test 4: UI状态一致性
  - **Property 4: UI状态一致性**
  - **Validates: Requirements 5.1, 5.2, 5.3**
  - Mock DOM 元素
  - 使用 fast-check 生成随机 phase
  - 验证 UIManager.updatePhaseUI 显示正确的 UI

- [ ]* 20. 编写Property Test 5: Phase消息完整性
  - **Property 5: Phase消息完整性**
  - **Validates: Requirements 4.1, 4.2, 4.3**
  - 使用 fast-check 生成随机 Profile 数据
  - 验证 S2C_PROFILE 消息包含有效的 phase
  - 验证客户端正确更新 phase

- [ ] 21. 添加错误处理 - Phase未接收时的操作
  - 在所有需要 phase 的操作前检查 phaseManager.getPhase() !== null
  - 如果 phase 为 null，记录警告并忽略操作
  - 显示加载提示，等待服务端响应
  - _Requirements: 6.1_

- [ ] 22. 添加错误处理 - Phase不一致检测
  - 在服务端检测客户端 phase 与 Profile 不一致的情况
  - 强制发送正确的 S2C_PROFILE 消息
  - 记录详细的不一致日志
  - _Requirements: 6.2_

- [ ] 23. 添加错误处理 - RAID中断线超时
  - 在服务端清理超时的玩家实体
  - 将 Profile.phase 重置为 HIDEOUT
  - 玩家重连时收到 HIDEOUT 状态
  - _Requirements: 6.3_

- [ ] 24. 添加错误处理 - 非法Phase转换
  - 在 PhaseTransitionHandler 中检查当前 phase
  - 如果不符合预期，记录错误并拒绝转换
  - 返回错误消息给客户端
  - _Requirements: 6.4_

- [ ] 25. 清理旧代码 - 客户端
  - 删除 main.ts 中的 currentPhase 变量
  - 删除分散的 phase 检查和更新逻辑
  - 删除旧的 updatePhaseUI 函数（如果有）
  - 确保所有 phase 访问通过 PhaseManager
  - _Requirements: 所有_

- [ ] 26. 清理旧代码 - 服务端
  - 删除分散的 phase 更新逻辑
  - 删除旧的重连处理代码
  - 确保所有 phase 转换通过 PhaseTransitionHandler
  - _Requirements: 所有_

- [ ] 27. Checkpoint - 完整测试
  - 运行所有单元测试
  - 运行所有 property tests
  - 执行手动测试清单中的所有项目
  - 测试所有刷新场景
  - 测试所有断线重连场景
  - 测试边界情况
  - 确保所有测试通过，没有回归问题

- [ ]* 28. 编写集成测试 - 完整phase转换流程
  - 启动测试服务器
  - 模拟客户端连接
  - 测试完整的 phase 转换序列（NAME -> HIDEOUT -> RAID -> RESULT -> HIDEOUT）
  - 验证消息序列和状态变化
  - _Requirements: 所有_

- [ ]* 29. 编写集成测试 - 刷新和重连场景
  - 测试在各个 phase 刷新页面
  - 测试断线重连
  - 测试快速多次刷新
  - 验证状态一致性
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 30. 添加调试工具 - Phase转换历史
  - 在 PhaseManager 中记录 phase 转换历史
  - 提供方法查看历史记录
  - 在 HUD 中显示最近的转换（可选）
  - _Requirements: 7.1, 7.2_

- [ ] 31. 添加调试工具 - 管理员命令
  - 添加 C2S_ADMIN 命令支持强制修改 phase
  - 仅在开发环境启用
  - 记录所有管理员操作
  - _Requirements: 7.4_

- [ ] 32. 文档更新
  - 更新 README.md，说明新的 phase 系统架构
  - 添加 phase 系统的开发者文档
  - 更新 PHASE_DISPLAY.md，反映新的实现
  - 添加故障排查指南

- [ ] 33. 最终验证
  - 在开发环境进行完整测试
  - 验证所有需求都已满足
  - 确认没有性能回归
  - 准备部署

## Notes

- 任务标记 `*` 的是可选的测试任务，可以根据时间安排决定是否实现
- 每个任务都引用了具体的需求编号，便于追溯
- Checkpoint 任务确保增量验证，避免积累问题
- 迁移策略是渐进式的，确保系统在重构过程中保持稳定
- 优先实现核心功能，然后添加测试和错误处理
- 最后清理旧代码，确保代码库整洁
