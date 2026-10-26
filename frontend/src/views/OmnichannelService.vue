<template>
  <div class="omni" :style="{ gridTemplateColumns: omniGridColumns }">
    <aside class="omni-list">
      <div class="omni-list-body">
      <div class="omni-list-head">
        <div class="omni-stat-chip" title="多媒体会话：当日已完成 | 客户列表未完成（含未分配）">
          <span class="omni-stat-label">多媒体会话</span>
          <strong>
            <em class="ok">{{ sessionDone }}</em>
            <span class="sep">|</span>
            <em class="miss">{{ sessionPending }}</em>
          </strong>
        </div>
        <div v-if="voiceEnabled" class="omni-stat-chip" title="当日本人已接 | 未接">
          <span class="omni-stat-label">当日话务</span>
          <strong>
            <em class="ok">{{ dailyAnswered }}</em>
            <span class="sep">|</span>
            <em class="miss">{{ dailyMissed }}</em>
          </strong>
        </div>
      </div>
      <SessionWorkspaceToolbar
        channel="media"
        :conversation-id="activeConversationId"
        @contact-agent="onInternalPicked"
      />
      <el-tabs v-model="listTab" class="omni-tabs">
        <el-tab-pane label="客户列表" name="customers" />
        <el-tab-pane label="历史会话" name="history" />
        <el-tab-pane name="internal">
          <template #label>
            <span class="omni-internal-tab-label">
              坐席间
              <em v-if="agentIm.pendingRestCount > 0" class="omni-internal-badge">
                {{ agentIm.pendingRestCount }}
              </em>
              <em v-else-if="agentIm.unreadTotal > 0" class="omni-internal-badge is-msg">
                {{ agentIm.unreadTotal }}
              </em>
            </span>
          </template>
        </el-tab-pane>
      </el-tabs>
      <el-input v-model="listQuery" placeholder="搜索客户、消息" clearable size="small" class="omni-search" />
      <div v-if="listTab === 'history'" class="omni-history-tools">
        <el-date-picker
          v-model="historyRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          size="small"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
        <el-button v-permission="'conversation.export'" size="small" type="primary" plain :loading="historyExporting" @click="exportHistory">
          <el-icon><Download /></el-icon>
          导出
        </el-button>
      </div>
      <el-scrollbar class="omni-scroll">
        <div
          v-for="c in displayContacts"
          :key="c.id"
          class="omni-row"
          :class="{ active: c.id === activeId, pinned: isPinned(c.id), flagged: isFlagged(c.id) }"
          @click="selectContact(c.id)"
          @contextmenu.prevent="openSessionMenu($event, c)"
        >
          <div class="omni-row-main">
            <el-avatar :size="29" :class="avatarClass(c)">{{ phoneDisplayName(c).slice(0, 1) }}</el-avatar>
            <div class="omni-peer">
              <div class="omni-peer-head">
                <div class="omni-peer-title">
                  <span v-if="isPinned(c.id)" class="pin-mark" title="已置顶">
                    <el-icon><Top /></el-icon>
                  </span>
                  <span v-if="isFlagged(c.id)" class="flag-mark" title="已标记">
                    <el-icon><Flag /></el-icon>
                  </span>
                  <span
                    v-if="isPhoneContact(c)"
                    class="call-kind-ico"
                    :title="callKindTitle(c)"
                  >
                    <el-icon><component :is="callKindIcon(c)" /></el-icon>
                  </span>
                  <span
                    v-if="isPhoneContact(c) && callConnectedState(c) != null"
                    class="call-conn-ico"
                    :class="callConnectedState(c) ? 'is-ok' : 'is-miss'"
                    :title="callConnectedState(c) ? '已接通' : '未接通'"
                  >
                    <el-icon><component :is="callConnectedState(c) ? PhoneFilled : Phone" /></el-icon>
                  </span>
                  <span class="omni-name">{{ phoneDisplayName(c) }} ({{ phoneDisplayCode(c) }})</span>
                  <span v-if="c.queued" class="omni-life-tag queued">排队{{ c.queue_position ? ` · 第${c.queue_position}位` : '' }}</span>
                  <span v-if="lifecycleLabel(c)" class="omni-life-tag" :class="c.omni_lifecycle">{{ lifecycleLabel(c) }}</span>
                  <span class="ch-icons-inline">
                    <el-icon v-if="c.channels.includes('wechat')" class="ch-wechat" title="微信公众号"><ChatDotRound /></el-icon>
                    <el-icon v-if="c.channels.includes('wecom')" class="ch-wecom" title="企业微信"><OfficeBuilding /></el-icon>
                    <el-icon v-if="c.channels.includes('miniprogram')" class="ch-miniprogram" title="小程序"><Grid /></el-icon>
                    <el-icon v-if="c.channels.includes('web')" class="ch-web" title="网站 Widget"><Monitor /></el-icon>
                    <el-icon v-if="c.channels.includes('weibo')" class="ch-weibo" title="微博"><Share /></el-icon>
                    <el-icon v-if="c.channels.includes('email')" class="ch-email" title="邮件"><Message /></el-icon>
                    <el-icon v-if="c.channels.includes('sms')" class="ch-sms" title="短信"><Cellphone /></el-icon>
                    <el-icon v-if="c.channels.includes('api')" class="ch-api" title="API / APP"><Connection /></el-icon>
                    <el-icon v-if="c.channels.includes('social')" class="ch-social" title="社媒"><ChatLineRound /></el-icon>
                    <el-icon v-if="c.channels.includes('phone')" class="ch-phone" title="电话"><Phone /></el-icon>
                  </span>
                  <el-badge
                    v-if="c.unread && c.id !== activeId"
                    :value="c.unread"
                    class="unread"
                  />
                </div>
              </div>
              <div class="preview">{{ c.last_message }}</div>
              <div v-if="c.time_label" class="omni-time">{{ c.time_label }}</div>
            </div>
            <button v-permission="'conversation.close'"
              v-if="listTab === 'customers'"
              type="button"
              class="omni-done-btn"
              title="完成"
              aria-label="完成会话"
              @click.stop="markConversationDone(c)"
            >
              <el-icon><CircleCheck /></el-icon>
            </button>
          </div>
        </div>
      </el-scrollbar>
      </div>

      <Teleport to="body">
        <div
          v-if="sessionMenu.visible"
          class="session-ctx-menu"
          :style="{ left: `${sessionMenu.x}px`, top: `${sessionMenu.y}px` }"
          @click.stop
        >
          <button type="button" class="session-ctx-item" @click="runSessionMenu('pin')">
            <el-icon><Top /></el-icon><span>置顶</span>
          </button>
          <button type="button" class="session-ctx-item" @click="runSessionMenu('unread')">
            <el-icon><Message /></el-icon><span>标为未读</span>
          </button>
          <button type="button" class="session-ctx-item" @click="runSessionMenu('flag')">
            <el-icon><Flag /></el-icon><span>标记</span>
          </button>
          <button type="button" class="session-ctx-item" @click="runSessionMenu('label')">
            <el-icon><PriceTag /></el-icon><span>新建标签</span>
          </button>
          <button type="button" class="session-ctx-item" @click="runSessionMenu('mute')">
            <el-icon><Bell /></el-icon><span>静音通知</span>
          </button>
          <button
            v-if="listTab === 'customers'"
            type="button"
            class="session-ctx-item"
            @click="runSessionMenu('done')"
          >
            <el-icon><CircleCheck /></el-icon><span>完成</span>
          </button>
          <div class="session-ctx-divider" />
          <button type="button" class="session-ctx-item" @click="runSessionMenu('open_nav')">
            <el-icon><Position /></el-icon><span>在导航栏打开</span>
          </button>
          <button type="button" class="session-ctx-item" @click="runSessionMenu('new_window')">
            <el-icon><CopyDocument /></el-icon><span>在新窗口打开</span>
          </button>
        </div>
      </Teleport>
      <div class="omni-footer">
        <button
          v-for="s in visibleChannelSummary"
          :key="s.channel_group"
          type="button"
          class="sum-item"
          :class="{ active: channelGroupFilter === s.channel_group }"
          :title="s.label"
          @click="selectChannelGroupFilter(s.channel_group)"
        >
          <el-icon><component :is="s.icon" /></el-icon>
          <span class="sum-label">{{ s.label }}</span>
          <el-badge :value="s.unread" :hidden="s.unread === 0" />
        </button>
      </div>
    </aside>

    <div
      class="omni-resize-track"
      :class="{ 'is-dragging': listResizing }"
      title="拖动调整左侧会话列表宽度"
      @mousedown.prevent="onListResizeStart"
    />

    <section ref="chatPanelEl" class="omni-chat">
      <header class="omni-chat-head" v-if="activeContact">
        <div>
          <div class="peer-line">
            <strong>{{ phoneDisplayName(activeContact) }}</strong>
            <el-tag v-for="t in activeContact.tags" :key="t" size="small" class="tag">{{ t }}</el-tag>
          </div>
          <div class="meta">
            接入次数: {{ activeContact.visit_count }} 次 · 来源: {{ activeContact.source }}
          </div>
        </div>
        <div class="omni-head-right">
          <PhoneCallToolbar
            v-if="showPhoneCallToolbar"
            ref="phoneToolbarRef"
            class="omni-head-phone-toolbar"
          />
          <PhoneCallToolbar
            v-else-if="showMediaSessionToolbar"
            ref="phoneToolbarRef"
            channel="media"
            :conversation-id="activeConversationId"
            :session-live="!isSessionEnded"
            class="omni-head-phone-toolbar"
          />
          <div v-if="listTab === 'customers'" class="omni-actions">
            <span class="omni-session-duration" title="会话时长">
              <span class="omni-session-duration-label">会话时长</span>
              <em>{{ sessionTimerText }}</em>
            </span>
            <el-button size="small" text @click="refreshThread">
              <el-icon><Refresh /></el-icon>
            </el-button>
            <el-button v-permission="'conversation.close'"
              size="small"
              type="danger"
              plain
              :disabled="!activeContact"
              @click="endActiveSession"
            >
              结束会话
            </el-button>
          </div>
        </div>
      </header>

      <VideoCallPane
        v-if="activeVideoCall && desktopMedia.engine"
        class="omni-call-video"
        :engine="desktopMedia.engine"
        :call="activeVideoCall"
        :show-controls="false"
        mute-remote-audio
        @error="ElMessage.error($event)"
      />

      <div ref="threadEl" class="omni-thread">
        <div v-for="g in groupedMessages" :key="g.date" class="thread-day">
          <div class="day-label">{{ g.date }}</div>
          <MessageBubble v-for="m in g.items" :key="m.id" :message="m" />
        </div>
      </div>

      <div
        v-if="showLiveCaptionsRestore"
        class="live-captions live-captions--collapsed"
      >
        <button type="button" class="live-captions-toggle" @click="agentStore.setLiveCaptionsHidden(false)">
          显示字幕
        </button>
      </div>
      <div
        v-else-if="showLiveCaptions"
        class="live-captions"
      >
        <div class="live-captions-hd">
          <span>实时字幕</span>
          <button type="button" class="live-captions-toggle" @click="agentStore.setLiveCaptionsHidden(true)">
            隐藏
          </button>
        </div>
        <div class="live-captions-list">
          <div
            v-for="(c, i) in agentStore.liveCaptions"
            :key="`${c.ts}-${i}`"
            class="live-caption"
            :class="c.role"
          >
            <span class="live-caption-role">{{ c.role === 'agent' ? '坐席' : '客户' }}</span>
            <span class="live-caption-text">{{ c.text }}</span>
          </div>
          <div v-if="!agentStore.liveCaptions.length" class="live-captions-empty">暂无转写</div>
        </div>
      </div>

      <div v-if="activeContact && listTab === 'customers' && queueStatus?.queued" class="omni-queue-banner">
        <span>
          排队转人工中 · 已等待 {{ queueWaitLabel }}
          <template v-if="queueStatus.position != null"> · 第 {{ queueStatus.position }} 位</template>
          <template v-else-if="queueStatus.queueLen != null"> · 队前 {{ queueStatus.queueLen }} 人</template>
          <template v-if="queueStatus.ewt != null"> · 预计 {{ queueStatus.ewt }}s</template>
        </span>
        <el-button v-permission="'conversation.close'" size="small" type="danger" plain @click="leaveQueue">取消排队</el-button>
      </div>

      <div v-if="activeContact && listTab === 'customers' && isSessionEnded" class="omni-ended-banner">
        本次沟通已结束，客户仍在列表中。右键「完成」后进入历史会话。
      </div>
      <ChatComposer
        v-if="activeContact && listTab === 'customers'"
        ref="chatComposerRef"
        :conversation-id="activeConversationId"
        :session-id="activeId"
        :disabled="isSessionEnded || !!activeContact.observe_only"
        @sent="onComposerSent"
        @close="onComposerClose"
      />
      <footer
        v-else-if="activeContact && listTab === 'internal'"
        class="omni-internal-composer-wrap"
      >
        <div
          v-if="internalActive?.kind === 'rest_request' && pendingRestMsg"
          class="omni-rest-bar"
        >
          <span>{{ pendingRestMsg.text }}</span>
          <el-button v-permission="'schedule.approve'" size="small" type="success" @click="onApproveRest(0)">通过</el-button>
          <el-button v-permission="'schedule.approve'" size="small" @click="onApproveRest(1)">拒绝</el-button>
        </div>
        <AgentInternalComposer
          :peer-agent-id="agentIm.activePeerId"
          @sent="onInternalComposerSent"
        />
      </footer>
      <div v-else-if="activeContact && listTab === 'history'" class="omni-history-readonly">
        已结束会话，仅可查看记录
      </div>
    </section>

    <div
      class="omni-resize-track"
      :class="{ 'is-dragging': sideResizing }"
      title="拖动调整右侧栏宽度"
      @mousedown.prevent="onSideResizeStart"
    />

    <aside class="omni-side">
      <div class="side-tabs-bar">
        <el-tabs
          :model-value="sideTabsNavName"
          tab-position="top"
          class="side-tabs side-tabs-main"
          @tab-click="onSideMainTabClick"
        >
          <el-tab-pane label="客户资料" name="profile" />
          <el-tab-pane :label="channelGroupFilter === 'media' ? '会话记录' : '通话记录'" name="call" />
          <el-tab-pane label="咨询工单" name="consult" />
          <el-tab-pane label="售后工单" name="after" />
          <el-tab-pane label="电商订单" name="ecom" />
          <el-tab-pane label="知识库" name="kb" />
          <el-tab-pane label="快捷回复" name="canned" />
          <!-- 「在线留言」已合并到左侧导航的「留言」中心（业务导航 → 留言），
               这里不再重复提供入口，避免一处功能三处入口。 -->
        </el-tabs>
        <el-dropdown trigger="click" class="side-all-dropdown" @command="onMoreMenuCommand">
          <span class="side-all-trigger" :class="{ 'is-active': isMorePanelActive }">
            全部
            <el-icon class="side-all-arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="more_contact_history">接触历史</el-dropdown-item>
              <el-dropdown-item command="more_ecom_query">电商订单查询</el-dropdown-item>
              <el-dropdown-item command="more_mall_order">商城订单信息</el-dropdown-item>
              <el-dropdown-item command="more_sales_volume">客服销售量</el-dropdown-item>
              <el-dropdown-item command="more_spare_parts">备件信息查询</el-dropdown-item>
              <el-dropdown-item command="more_equipment_file">设备档案查询</el-dropdown-item>
              <el-dropdown-item divided command="itr_start">启动 ITR 流程</el-dropdown-item>
              <el-dropdown-item command="media_transfer">转接会话</el-dropdown-item>
              <el-dropdown-item command="csat_invite">发送满意度</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <el-scrollbar v-if="sideTab === 'profile' && customerDetail" class="side-scroll">
        <div class="crm-side-form">
          <el-form label-width="64px" size="small">
            <el-form-item label="姓名">
              <el-input v-model="customerDetail.name" />
            </el-form-item>
            <el-form-item label="手机">
              <el-input v-model="customerDetail.phone" placeholder="手机号" />
            </el-form-item>
            <el-form-item label="邮箱">
              <el-input v-model="customerDetail.email" />
            </el-form-item>
            <el-form-item label="性别">
              <el-select v-model="customerDetail.gender" style="width: 100%">
                <el-option label="未知" value="未知" />
                <el-option label="男" value="男" />
                <el-option label="女" value="女" />
                <el-option label="—" value="—" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-input v-model="customerDetail.customer_type" />
            </el-form-item>
            <el-form-item label="等级">
              <el-input v-model="customerDetail.level" />
            </el-form-item>
            <el-form-item label="地址">
              <el-input v-model="customerDetail.address" />
            </el-form-item>
            <el-form-item label="标签">
              <el-select
                v-model="crmSideLabelIds"
                multiple
                filterable
                style="width: 100%"
                placeholder="选择标签"
                :disabled="!customerDetail.id"
              >
                <el-option
                  v-for="l in crmLabelOptions"
                  :key="l.id"
                  :label="l.title"
                  :value="l.id"
                />
              </el-select>
            </el-form-item>
          </el-form>
          <el-button v-permission="'customer.update'"
            type="primary"
            size="small"
            class="crm-save-btn"
            :loading="crmSaving"
            :disabled="!customerDetail.id"
            @click="saveCrmSideProfile"
          >
            保存客户资料
          </el-button>
          <el-button
            v-if="customerDetail.id"
            text
            type="primary"
            size="small"
            @click="router.push({ name: 'customer-profile', params: { id: String(customerDetail.id) } })"
          >
            打开完整画像
          </el-button>
        </div>

        <div class="side-sub">购买记录</div>
        <el-table :data="customerDetail.orders" size="small" stripe border class="side-table">
          <el-table-column prop="order_no" label="订单号" min-width="100">
            <template #default="{ row }">
              <el-link type="primary" underline="always" href="#" @click.prevent>{{ row.order_no }}</el-link>
            </template>
          </el-table-column>
          <el-table-column prop="product_name" label="产品名" min-width="100" />
          <el-table-column prop="store" label="购买店铺" min-width="90" show-overflow-tooltip />
          <el-table-column prop="date" label="购买日期" width="100" />
          <el-table-column prop="price" label="价格" width="72" align="right" />
        </el-table>

        <div class="side-sub">访问轨迹</div>
        <el-table :data="customerDetail.visits" size="small" stripe border class="side-table visits-table">
          <el-table-column prop="product_name" label="产品名" min-width="100" show-overflow-tooltip />
          <el-table-column prop="visit_time" label="访问时间" width="118" />
          <el-table-column label="产品链接" min-width="120">
            <template #default="{ row }">
              <el-link
                class="link-cell"
                type="primary"
                :href="row.product_link"
                target="_blank"
                rel="noopener"
                underline="always"
              >
                {{ row.product_link }}
              </el-link>
            </template>
          </el-table-column>
        </el-table>

        <div class="side-sub">回访内容</div>
        <el-table
          :data="customerDetail.return_visits ?? []"
          size="small"
          stripe
          border
          class="side-table return-visits-table"
        >
          <el-table-column prop="visit_time" label="回访时间" width="118" />
          <el-table-column prop="channel" label="回访方式" width="76" />
          <el-table-column prop="content" label="回访内容" min-width="120" show-overflow-tooltip />
          <el-table-column prop="result" label="处理结果" min-width="88" show-overflow-tooltip />
          <el-table-column prop="agent" label="回访人" width="72" />
        </el-table>
      </el-scrollbar>

      <el-scrollbar v-else-if="sideTab === 'call'" class="side-scroll call-scroll">
        <div v-if="!activeContact">
          <el-empty description="请选择会话" />
        </div>
        <div v-else v-loading="callRecordLoading">
          <el-empty v-if="!callRecordItems.length" :description="channelGroupFilter === 'media' ? '暂无会话记录' : '暂无通话记录'">
            <el-button size="small" :loading="callRecordLoading" @click="loadCallRecord">刷新</el-button>
          </el-empty>
          <template v-else>
            <div class="side-sub">{{ channelGroupFilter === 'media' ? '会话记录' : '通话记录' }}</div>
            <el-table :data="callRecordItems" size="small" stripe border class="side-table call-history-table">
              <el-table-column prop="offered_at_label" :label="channelGroupFilter === 'media' ? '开始时间' : '呼入时间'" min-width="138" />
              <el-table-column prop="caller" :label="channelGroupFilter === 'media' ? '访客' : '主叫'" min-width="88" show-overflow-tooltip />
              <el-table-column prop="method_label" label="方式" width="108" show-overflow-tooltip />
              <el-table-column prop="hangup_reason" :label="channelGroupFilter === 'media' ? '结束原因' : '挂断原因'" min-width="100" show-overflow-tooltip />
              <el-table-column prop="talk_time_label" label="时长" width="56" />
              <el-table-column v-if="channelGroupFilter === 'media'" prop="assignee_work_no" label="坐席" width="72" show-overflow-tooltip />
              <el-table-column v-else label="录音" width="108" class-name="call-ops-col">
                <template #default="{ row }">
                  <div class="call-ops">
                    <el-tooltip :content="row.has_recording ? '坐席播放' : '无录音'" placement="top">
                      <span class="call-op-wrap">
                        <el-button v-permission="'conversation.recording'"
                          link
                          type="primary"
                          size="small"
                          :icon="Headset"
                          :disabled="!row.has_recording"
                          :loading="agentPlayKey === callRowKey(row)"
                          @click="playOnAgent(row)"
                        />
                      </span>
                    </el-tooltip>
                    <el-tooltip :content="row.has_recording ? '本地播放' : '无录音'" placement="top">
                      <span class="call-op-wrap">
                        <el-button v-permission="'conversation.recording'"
                          link
                          type="primary"
                          size="small"
                          :icon="VideoPlay"
                          :disabled="!row.has_recording"
                          :loading="callAudioLoading && playingCallKey === callRowKey(row)"
                          @click="playLocal(row)"
                        />
                      </span>
                    </el-tooltip>
                    <el-tooltip :content="row.has_recording ? '下载' : '无录音'" placement="top">
                      <span class="call-op-wrap">
                        <el-button v-permission="'conversation.recording'"
                          link
                          type="primary"
                          size="small"
                          :icon="Download"
                          :disabled="!row.has_recording"
                          :loading="downloadKey === callRowKey(row)"
                          @click="downloadRecording(row)"
                        />
                      </span>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>
            </el-table>
            <div v-if="channelGroupFilter !== 'media' && (callAudioUrl || agentPlayingKey || callAudioError)" class="call-player">
              <div v-if="playingCallLabel" class="call-player-label">本地播放 · {{ playingCallLabel }}</div>
              <audio
                v-if="callAudioUrl"
                :src="callAudioUrl"
                controls
                autoplay
                preload="metadata"
                class="call-audio"
              />
              <div v-if="agentPlayingKey" class="call-player-actions">
                <el-button size="small" @click="stopAgentPlay">停止坐席播放</el-button>
              </div>
              <p v-if="callAudioError" class="call-audio-error">{{ callAudioError }}</p>
            </div>
            <template v-if="callRecord && callRecord.is_voice !== false">
              <div class="side-sub">本通详情</div>
              <el-descriptions :column="1" border size="small" class="desc">
                <el-descriptions-item label="主叫">{{ callRecord.caller || '—' }}</el-descriptions-item>
                <el-descriptions-item label="被叫">{{ callRecord.called || '—' }}</el-descriptions-item>
                <el-descriptions-item label="方式">{{ callRecordMethodLabel }}</el-descriptions-item>
                <el-descriptions-item label="技能组">{{ callRecord.skill_group_name || '—' }}</el-descriptions-item>
                <el-descriptions-item label="通话时长">{{ callRecord.talk_time_label || '—' }}</el-descriptions-item>
                <el-descriptions-item label="录音状态">{{ callRecordStatusLabel }}</el-descriptions-item>
              </el-descriptions>
            </template>
            <template v-else-if="callRecord">
              <div class="side-sub">本通详情</div>
              <el-descriptions :column="1" border size="small" class="desc">
                <el-descriptions-item label="访客">{{ callRecord.caller || '—' }}</el-descriptions-item>
                <el-descriptions-item label="坐席">{{ callRecord.called || '—' }}</el-descriptions-item>
                <el-descriptions-item label="方式">{{ callRecordMethodLabel }}</el-descriptions-item>
                <el-descriptions-item label="技能组">{{ callRecord.skill_group_name || '—' }}</el-descriptions-item>
                <el-descriptions-item label="会话时长">{{ callRecord.talk_time_label || '—' }}</el-descriptions-item>
              </el-descriptions>
              <template v-if="callRecord.events?.length">
                <div class="side-sub">坐席行为</div>
                <el-timeline class="session-event-timeline">
                  <el-timeline-item
                    v-for="(ev, i) in callRecord.events"
                    :key="`${ev.created_at}-${i}`"
                    :timestamp="ev.created_at_label"
                    placement="top"
                  >
                    {{ ev.summary || ev.event_label }}
                  </el-timeline-item>
                </el-timeline>
              </template>
            </template>
            <el-button
              class="call-refresh"
              size="small"
              :loading="callRecordLoading"
              @click="loadCallRecord"
            >
              刷新
            </el-button>
          </template>
        </div>
      </el-scrollbar>

      <el-scrollbar v-else-if="sideTab === 'consult'" class="side-scroll consult-scroll">
        <el-form :model="consultForm" label-position="top" size="small" class="consult-form">
          <el-form-item label="产品主体">
            <el-select v-model="consultForm.productMain" placeholder="请选择" style="width: 100%">
              <el-option label="美的品牌" value="midea" />
              <el-option label="小天鹅" value="littleswan" />
              <el-option label="东芝" value="toshiba" />
            </el-select>
          </el-form-item>
          <el-form-item label="产品大类">
            <el-select v-model="consultForm.productCategory" placeholder="请选择" style="width: 100%">
              <el-option label="订单中心" value="order_center" />
              <el-option label="空调品类" value="ac" />
              <el-option label="冰箱洗衣机" value="fridge" />
            </el-select>
          </el-form-item>
          <el-form-item label="客户姓名">
            <el-input v-model="consultForm.customerName" placeholder="请输入客户姓名" />
          </el-form-item>
          <el-form-item label="电话号码">
            <el-input v-model="consultForm.phone" placeholder="请输入电话号码" />
          </el-form-item>
          <el-form-item label="详细地址">
            <el-input v-model="consultForm.address" placeholder="请输入详细地址" />
          </el-form-item>
          <el-form-item label="客户渠道">
            <el-radio-group v-model="consultForm.customerChannel">
              <el-radio-button value="online">线上</el-radio-button>
              <el-radio-button value="offline">线下</el-radio-button>
              <el-radio-button value="none">无</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="订单编号">
            <el-input v-model="consultForm.orderNo" placeholder="请输入订单编号" />
          </el-form-item>
          <el-form-item label="店铺名称">
            <el-input v-model="consultForm.storeName" placeholder="请输入店铺名称" />
          </el-form-item>
          <el-form-item label="咨询分类">
            <el-radio-group v-model="consultForm.consultClass" class="consult-class-grid">
              <el-radio v-for="opt in consultClassOptions" :key="opt.value" :value="opt.value" border>
                {{ opt.label }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="咨询小类">
            <div class="consult-sub-row">
                <el-select v-model="consultForm.consultSub1" placeholder="请选择" style="flex: 1">
                <el-option
                  v-for="n in consultSub1Options"
                  :key="n"
                  :label="`小类选项 ${n}`"
                  :value="`sub1_${n}`"
                />
              </el-select>
              <el-select v-model="consultForm.consultSub2" placeholder="请选择" style="flex: 1">
                <el-option label="下拉选项 1" value="o1" />
                <el-option label="下拉选项 2" value="o2" />
                <el-option label="下拉选项 3" value="o3" />
              </el-select>
            </div>
          </el-form-item>
          <el-form-item label="紧急程度">
            <el-radio-group v-model="consultForm.urgency" class="urgency-group">
              <el-radio value="high" class="urg-radio">
                <span class="urg-flag urg-high" />
                高
              </el-radio>
              <el-radio value="medium" class="urg-radio">
                <span class="urg-flag urg-medium" />
                中
              </el-radio>
              <el-radio value="low" class="urg-radio">
                <span class="urg-flag urg-low" />
                低
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="选择模板">
            <div class="template-box">
              <el-button type="primary" plain class="template-add" @click="onAddTemplate">
                <el-icon><Plus /></el-icon>
                点击添加模板
              </el-button>
            </div>
          </el-form-item>
          <div class="consult-actions">
            <el-button type="primary" @click="onConsultSubmit">提交</el-button>
            <el-button @click="onConsultSave">保存</el-button>
          </div>
        </el-form>
      </el-scrollbar>

      <el-scrollbar v-else-if="sideTab === 'after'" class="side-scroll after-scroll">
        <div class="after-toolbar">
          <el-input
            v-model="afterPhoneQuery"
            placeholder="请输入用户电话号码"
            clearable
            size="small"
            class="after-phone-input"
            @keyup.enter="loadAfterSales"
          />
          <el-button type="primary" size="small" @click="loadAfterSales">查询</el-button>
        </div>
        <el-table
          :data="afterSalesRows"
          v-loading="afterSalesLoading"
          size="small"
          stripe
          border
          class="after-table"
          empty-text="暂无档案，请输入手机号查询"
        >
          <el-table-column prop="product_category" label="产品品类" min-width="92" />
          <el-table-column prop="file_no" label="档案编号" min-width="128">
            <template #default="{ row }">
              <el-link type="primary" underline="always" href="#" @click.prevent="openAfterFile(row)">
                {{ row.file_no }}
              </el-link>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="产品信息" min-width="160" show-overflow-tooltip />
        </el-table>
      </el-scrollbar>

      <el-scrollbar v-else-if="sideTab === 'ecom'" class="side-scroll ecom-scroll">
        <div class="ecom-toolbar">
          <el-input
            v-model="ecomQuery"
            placeholder="请输入收货人电话、姓名或查询订单号"
            clearable
            size="small"
            class="ecom-search-input"
            @keyup.enter="loadEcomOrders"
          />
          <el-button type="primary" size="small" @click="loadEcomOrders">查询</el-button>
        </div>
        <div v-loading="ecomLoading" class="ecom-list">
          <div v-for="(o, idx) in ecomOrders" :key="`${o.order_no}-${idx}`" class="ecom-card">
            <div class="ecom-card-head">
              <span class="ecom-badge">订单 {{ idx + 1 }}</span>
            </div>
            <div class="ecom-section ecom-grid-2">
              <div class="ecom-col">
                <div class="ecom-field">
                  <span class="ecom-k">订单编号</span>
                  <span class="ecom-v">{{ o.order_no }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">订单状态</span>
                  <span class="ecom-v">{{ o.status }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">店铺名称</span>
                  <span class="ecom-v">{{ o.shop_name }}</span>
                </div>
              </div>
              <div class="ecom-col">
                <div class="ecom-field">
                  <span class="ecom-k">订单日期</span>
                  <span class="ecom-v">{{ o.order_date }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">销售平台</span>
                  <span class="ecom-v">{{ o.platform }}</span>
                </div>
              </div>
            </div>
            <div class="ecom-dotted-line" />
            <div class="ecom-section ecom-grid-2">
              <div class="ecom-col">
                <div class="ecom-field">
                  <span class="ecom-k">收货人</span>
                  <span class="ecom-v">{{ o.recipient }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">收货地址</span>
                  <span class="ecom-v">{{ o.address }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">收货日期</span>
                  <span class="ecom-v">{{ o.delivery_date }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">订单金额</span>
                  <span class="ecom-v ecom-money">{{ o.amount }}</span>
                </div>
              </div>
              <div class="ecom-col">
                <div class="ecom-field">
                  <span class="ecom-k">电话号码</span>
                  <span class="ecom-v">{{ o.phone }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">产品型号</span>
                  <span class="ecom-v">{{ o.product_model }}</span>
                </div>
                <div class="ecom-field">
                  <span class="ecom-k">发票号</span>
                  <span class="ecom-v">{{ o.invoice_no }}</span>
                </div>
              </div>
            </div>
            <div class="ecom-dotted-line" />
            <div class="ecom-logistics-block">
              <div class="ecom-tracking">
                <span class="ecom-k">物流单号</span>
                <span class="ecom-v ecom-tracking-no">{{ o.tracking_no }}</span>
              </div>
              <div class="ecom-tl-heading">物流状态</div>
              <ul class="ecom-timeline">
                <li
                  v-for="(step, si) in o.logistics"
                  :key="si"
                  class="ecom-tl-item"
                  :class="{ 'is-active': step.active }"
                >
                  <span class="ecom-tl-dot" />
                  <div class="ecom-tl-content">
                    <div class="ecom-tl-meta">
                      {{ step.time }}
                      <span class="ecom-tl-loc">【{{ step.location }}】</span>
                    </div>
                    <div class="ecom-tl-text">{{ step.text }}</div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
          <el-empty v-if="!ecomLoading && ecomOrders.length === 0" description="暂无订单，请输入条件查询" />
        </div>
      </el-scrollbar>

      <el-scrollbar v-else-if="sideTab === 'kb'" class="side-scroll kb-scroll">
        <KnowledgeWorkspace compact :conversation-id="activeConversationId" @draft="text => chatComposerRef?.setDraft?.(text)" />
      </el-scrollbar>

      <el-scrollbar v-else-if="sideTab === 'canned'" class="side-scroll">
        <div class="kb-toolbar">
          <el-button type="primary" size="small" @click="loadCanned">刷新常用语</el-button>
        </div>
        <div v-loading="cannedLoading" class="kb-list">
          <div
            v-for="item in cannedItems"
            :key="item.id"
            class="kb-item"
            @click="insertCanned(item)"
          >
            <div class="kb-item-head">
              <span class="kb-item-title">{{ item.short_code || item.id }}</span>
            </div>
            <p class="kb-item-summary">{{ item.content }}</p>
          </div>
          <el-empty v-if="!cannedLoading && cannedItems.length === 0" description="暂无常用语，请在管理端配置 canned_responses" />
        </div>
      </el-scrollbar>

      <el-scrollbar v-else-if="sideTab === 'leave'" class="side-scroll">
        <div class="kb-toolbar">
          <el-button type="primary" size="small" @click="loadLeaveMessages">刷新留言</el-button>
        </div>
        <div v-loading="leaveLoading" class="kb-list">
          <div v-for="item in leaveItems" :key="item.id" class="kb-item">
            <div class="kb-item-head">
              <span class="kb-item-title">会话 #{{ item.conversationId }} · {{ item.status }}</span>
              <span class="kb-item-time">{{ item.createdAt }}</span>
            </div>
            <p class="kb-item-summary">{{ item.content }}</p>
            <el-button v-permission="'voicemail.claim'"
              v-if="item.status === 'open'"
              size="small"
              type="primary"
              link
              @click="claimLeave(item)"
            >
              认领
            </el-button>
          </div>
          <el-empty v-if="!leaveLoading && leaveItems.length === 0" description="暂无在线留言" />
        </div>
      </el-scrollbar>

      <el-scrollbar v-else class="side-scroll">
        <el-empty :description="`${sideTabLabel} · 功能开发中`" />
      </el-scrollbar>
    </aside>

    <el-dialog
      v-model="restApproveVisible"
      :title="restApproveStatus === 0 ? '同意小休' : '拒绝小休'"
      width="420px"
      append-to-body
      :close-on-click-modal="false"
      @closed="onRestApproveClosed"
    >
      <div class="rest-approve-form">
        <p v-if="restApproveHint" class="rest-approve-hint">{{ restApproveHint }}</p>
        <label class="rest-approve-label">
          {{ restApproveStatus === 0 ? '审批意见（可选）' : '拒绝原因' }}
        </label>
        <el-input
          v-model="restApproveOpinion"
          type="textarea"
          :rows="3"
          :placeholder="restApproveStatus === 0 ? '同意' : '拒绝原因'"
          maxlength="200"
          show-word-limit
        />
        <div v-if="restApproveStatus === 0" class="rest-approve-duration">
          <label class="rest-approve-label">允许时长</label>
          <div class="rest-approve-duration-field">
            <el-input-number
              v-model="restApproveMinutes"
              :min="1"
              :max="240"
              :step="1"
              controls-position="right"
            />
            <span class="rest-approve-unit">分钟（到时自动示闲）</span>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="restApproveVisible = false">取消</el-button>
        <el-button v-permission="'schedule.approve'"
          :type="restApproveStatus === 0 ? 'success' : 'danger'"
          :loading="restApproveSubmitting"
          @click="submitRestApprove"
        >
          {{ restApproveStatus === 0 ? '同意' : '拒绝' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="xferVisible" title="转接会话" width="420px" destroy-on-close>
      <el-form label-width="88px" size="small">
        <el-form-item label="方式">
          <el-radio-group v-model="xferForm.mode">
            <el-radio value="agent">指定坐席</el-radio>
            <el-radio value="skill">技能再入队</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="xferForm.mode === 'agent'" label="用户 ID">
          <el-input v-model="xferForm.assigneeId" placeholder="Omni users.id" />
        </el-form-item>
        <template v-else>
          <el-form-item label="VDN">
            <el-input-number v-model="xferForm.vdnId" :min="1" controls-position="right" />
          </el-form-item>
          <el-form-item label="班组">
            <el-input-number v-model="xferForm.agentGroupId" controls-position="right" />
          </el-form-item>
          <el-form-item label="技能">
            <el-input-number v-model="xferForm.skillId" controls-position="right" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="xferVisible = false">取消</el-button>
        <el-button v-permission="'conversation.transfer'" type="primary" @click="submitMediaTransfer">转接</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, reactive, provide, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { messages as socketMessages } from '../services/socket'
import {
  ArrowDown,
  ChatDotRound,
  Monitor,
  Share,
  Phone,
  PhoneFilled,
  Switch,
  Refresh,
  Plus,
  CircleCheck,
  Top,
  Message,
  Flag,
  PriceTag,
  Bell,
  Position,
  CopyDocument,
  Headset,
  VideoPlay,
  UserFilled,
  Download,
  OfficeBuilding,
  Grid,
  Cellphone,
  Connection,
  ChatLineRound,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api/client'
import {
  toggleConversationStatus,
  markConversationUnread,
  muteConversation,
  addConversationLabels,
  toggleConversationPriority,
  updateConversationLastSeen,
  endOmniSession,
} from '@/api/conversations'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import KnowledgeWorkspace from '@/components/KnowledgeWorkspace.vue'
import MessageBubble from '@/components/chat/MessageBubble.vue'
import type { ThreadMsg } from '@/types/thread-message'
import AgentInternalComposer from '@/components/chat/AgentInternalComposer.vue'
import PhoneCallToolbar from '@/components/PhoneCallToolbar.vue'
import VideoCallPane from '@/components/VideoCallPane.vue'
import { useDesktopCallMediaStore } from '@/stores/desktop-call-media'
import { callPartyName, callPartyCode } from '@/utils/call-display'
import SessionWorkspaceToolbar from '@/components/SessionWorkspaceToolbar.vue'
import { useAgentInternalStore } from '@/stores/agentInternal'
import {
  SCREENSHOT_HIDE_TARGET,
  SCREENSHOT_LONG_TARGET,
} from '@/components/chat/screenshot-context'
import type { StAgentOnCallOfferedEvt } from '@/types/agent-ccs'
import { CCS_OFFER, supervisorOfferLabel } from '@/types/agent-ccs'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import { useAccessStore } from '@/stores/access'
import { useProductModulesStore } from '@/stores/product-modules'
import { readWorkspaceChannelPreference, writeWorkspaceChannelPreference } from '@/utils/workspace-channel-preference'
import { formatCcsError } from '@/utils/ccs-errors'
import {
  patchCustomer,
  putCustomerLabels,
  fetchCrmLabels,
  type CrmLabel,
} from '@/api/customers'

const authStore = useAuthStore()
const accessStore = useAccessStore()
const productModules = useProductModulesStore()
const voiceEnabled = computed(() => productModules.enabled('icc'))
const workspaceIdentity = () => ({ accountId: accessStore.accountId, userId: Number(authStore.user?.id ?? 0) })
const route = useRoute()
const router = useRouter()

const LIST_PANEL_MIN = 220
const LIST_PANEL_MAX = 520
const LIST_PANEL_DEFAULT = 300

const SIDE_PANEL_MIN = 240
const SIDE_PANEL_MAX = 720
const SIDE_PANEL_DEFAULT = 320

type ChannelGroup = 'media' | 'phone'

interface Contact {
  id: string
  conversation_id?: number
  name: string
  code: string
  last_message: string
  time_label: string
  unread: number
  channel_group?: ChannelGroup
  channel_type?: string | null
  channels: string[]
  tags: string[]
  visit_count: number
  source: string
  flagged?: boolean
  muted?: boolean
  omni_lifecycle?: 'active' | 'ended'
  talk_time_sec?: number | null
  recording_path?: string | null
  call_method?: string | null
  call_connected?: boolean | null
          observe_only?: boolean
  peerAgentId?: number
  internalKind?: 'im' | 'rest_request'
  queued?: boolean
  queue_position?: number | null
  queue_ewt?: number | null
}

interface ChannelSummaryRow {
  channel_group: ChannelGroup
  label: string
  icon: typeof ChatDotRound
  unread: number
}

const PINNED_STORAGE_KEY = 'omni_pinned_sessions'

interface PhoneSessionState {
  contact: Contact
  messages: ThreadMsg[]
}

const phoneSessions = ref<Map<string, PhoneSessionState>>(new Map())

function ccsPhoneSessionId(callId: number) {
  return `ccs-phone-${callId}`
}

function isCcsPhoneSession(id: string) {
  return id.startsWith('ccs-phone-')
}

function isPhoneContact(c: Contact) {
  return c.channel_group === 'phone' || c.channels.includes('phone')
}

function phoneDisplayName(contact: Contact): string {
  if (!isPhoneContact(contact)) return contact.name
  const current = agentStore.currentCall
  const matched = current && (String(current.Caller ?? '') === contact.code || String(current.Caller ?? '') === contact.name)
  return callPartyName(contact.name, matched ? current.MediaType ?? 0 : undefined)
}
function phoneDisplayCode(contact: Contact): string {
  return isPhoneContact(contact) ? callPartyCode(contact.code) : contact.code
}

function parseAgentCallMeta(evt: StAgentOnCallOfferedEvt): {
  agentCall: boolean
  role: 'caller' | 'callee' | null
  peerWorkNo: string
  peerName: string
  supervisor: string
} {
  const t = Number(evt.CallOfferedType ?? 0)
  const data = String(evt.CallData ?? '')
  const agentCall = t === CCS_OFFER.Agent || data.startsWith('agent_')
  const supervisor = supervisorOfferLabel(t)
  const role: 'caller' | 'callee' | null = !agentCall
    ? null
    : data === 'agent_caller'
      ? 'caller'
      : 'callee'
  let peerName = ''
  try {
    const j = evt.JsonPrivateInfo ? JSON.parse(String(evt.JsonPrivateInfo)) as { peerName?: string } : null
    peerName = String(j?.peerName ?? '').trim()
  } catch { /* ignore */ }
  const peerWorkNo = role === 'caller' ? String(evt.Called ?? '').trim() : String(evt.Caller ?? '').trim()
  return {
    agentCall,
    role,
    peerWorkNo: peerWorkNo || peerName || '未知坐席',
    peerName: peerName || peerWorkNo,
    supervisor,
  }
}

function buildPhoneContact(evt: StAgentOnCallOfferedEvt): Contact {
  const offeredType = Number(evt.CallOfferedType ?? 0)
  const outbound = offeredType === CCS_OFFER.CallOut
  const meta = parseAgentCallMeta(evt)
  const peer = meta.supervisor
    ? (meta.peerName || meta.peerWorkNo)
    : meta.agentCall
    ? meta.peerName
    : outbound
      ? (evt.Called ?? '未知号码')
      : (evt.Caller ?? '未知号码')
  const code = meta.supervisor || meta.agentCall ? meta.peerWorkNo : peer
  const callId = evt.CallID ?? 0
  const callMethod = meta.supervisor
    ? meta.supervisor
    : meta.agentCall
    ? (meta.role === 'caller' ? '坐席呼坐席·主叫方' : '坐席呼坐席·被叫方')
    : outbound
      ? '外呼'
      : offeredType === CCS_OFFER.Transfer
        ? '转接'
        : '来电'
  return {
    id: ccsPhoneSessionId(callId),
    name: peer,
    code,
    last_message: meta.supervisor
      ? `【${meta.supervisor}】${meta.peerName || meta.peerWorkNo}`
      : meta.agentCall
      ? (meta.role === 'caller' ? '【坐席呼坐席·主叫方】呼叫中…' : '【坐席呼坐席·被叫方】等待接听…')
      : outbound
        ? '【去电】外呼中…'
        : `【${callMethod}】等待接听…`,
    time_label: formatLocalDateTime(),
    unread: 1,
    channel_group: 'phone',
    channel_type: 'Channel::Voice',
    channels: ['phone'],
    tags: meta.supervisor
      ? [meta.supervisor]
      : meta.agentCall
        ? ['坐席呼坐席', meta.role === 'caller' ? '主叫方' : '被叫方']
        : [callMethod],
    visit_count: 0,
    source: meta.supervisor
      ? meta.supervisor
      : meta.agentCall
        ? '坐席呼坐席'
        : evt.DNIS
          ? `电话 · ${evt.DNIS}`
          : outbound
            ? '电话外呼'
            : '电话来电',
    call_method: callMethod,
    call_connected: false,
  }
}

function buildPhoneMessages(evt: StAgentOnCallOfferedEvt): ThreadMsg[] {
  const offeredType = Number(evt.CallOfferedType ?? 0)
  const outbound = offeredType === CCS_OFFER.CallOut
  const meta = parseAgentCallMeta(evt)
  const peer = meta.supervisor || meta.agentCall
    ? `${meta.peerName}${meta.peerWorkNo && meta.peerName !== meta.peerWorkNo ? ` (${meta.peerWorkNo})` : ''}`
    : outbound
      ? (evt.Called ?? '未知号码')
      : callPartyName(evt.Caller ?? '未知号码', evt.MediaType ?? 0)
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const roleLabel = meta.role === 'caller' ? '主叫方' : '被叫方'
  return [
    {
      id: `pm-${evt.CallID}-1`,
      from: 'customer',
      kind: 'text',
      text: meta.supervisor
        ? `📞 ${meta.supervisor} · ${peer}`
        : meta.agentCall
        ? `📞 坐席呼坐席（${roleLabel}）· ${peer}`
        : outbound
          ? `📞 正在呼叫 ${peer}`
          : `📞 来电接入（${peer}${evt.AreaCode ? ` · ${evt.AreaCode}` : ''}）`,
      time,
      day: '今天',
    },
    {
      id: `pm-${evt.CallID}-2`,
      from: 'agent',
      kind: 'bot',
      lines: meta.supervisor
        ? [`类型：${meta.supervisor}`, `目标坐席：${peer}`, '工具栏仅可释放退出']
        : meta.agentCall
        ? [`类型：坐席呼坐席`, `本席角色：${roleLabel}`, `对端账号：${peer}`]
        : outbound
          ? ['去电：呼叫坐席分机', peer ? `被叫分机：${peer}` : '被叫：—']
          : [
              evt.SkillGroupName ? `技能组：${evt.SkillGroupName}` : '技能组：—',
              '请点击工具栏「应答」接听来电',
            ],
      time,
      day: '今天',
    },
  ]
}

function mergeActivePhoneSessions(list: Contact[]): Contact[] {
  if (!voiceEnabled.value) return list.filter(c => !isPhoneContact(c))
  if (channelGroupFilter.value !== 'phone') return list
  const live = [...phoneSessions.value.values()].map((s) => ({
    ...s.contact,
    unread: s.contact.id === activeId.value ? 0 : s.contact.unread,
  }))
  const apiPhone = list.filter((c) => isPhoneContact(c) && !isCcsPhoneSession(c.id))
  return live.length ? [...live, ...apiPhone] : list
}

function handlePhoneOffered(ev: Event) {
  if (!voiceEnabled.value) return
  const evt = (ev as CustomEvent<StAgentOnCallOfferedEvt>).detail
  if (!evt) return
  const offeredType = Number(evt.CallOfferedType ?? 0)
  const outbound = offeredType === CCS_OFFER.CallOut
  const meta = parseAgentCallMeta(evt)
  const newId = ccsPhoneSessionId(evt.CallID ?? 0)
  const peer = meta.supervisor || meta.agentCall
    ? meta.peerWorkNo
    : outbound
      ? (evt.Called ?? '')
      : (evt.Caller ?? '')
  if (peer || meta.agentCall || meta.supervisor) {
    for (const [oldId, sess] of phoneSessions.value) {
      if (oldId === newId) continue
      const method = sess.contact.call_method || ''
      if (meta.supervisor) {
        if (method === meta.supervisor || method === '来电' || method === '外呼' || oldId === ccsPhoneSessionId(0)) {
          phoneSessions.value.delete(oldId)
          contacts.value = contacts.value.filter((c) => c.id !== oldId)
        }
        continue
      }
      if (meta.agentCall) {
        // 互呼只保留一条：清掉分机来电/外呼预览，即使已接通
        if (method.includes('坐席呼坐席') || method === '来电' || method === '外呼') {
          phoneSessions.value.delete(oldId)
          contacts.value = contacts.value.filter((c) => c.id !== oldId)
        }
        continue
      }
      if (sess.contact.call_connected) continue
      if (!(outbound && method === '外呼')) continue
      if (sess.contact.code === peer || sess.contact.name === peer) {
        phoneSessions.value.delete(oldId)
        contacts.value = contacts.value.filter((c) => c.id !== oldId)
      }
    }
  }
  const contact = buildPhoneContact(evt)
  if (outbound && !meta.agentCall) {
    contact.last_message = '【去电】外呼中…'
    contact.tags = ['外呼']
    contact.call_method = '外呼'
    contact.name = evt.Called ?? contact.name
    contact.code = evt.Called ?? contact.code
  }
  phoneSessions.value.set(newId, {
    contact,
    messages: buildPhoneMessages(evt),
  })
  listTab.value = 'customers'
  adjustChannelSummaryUnread('phone', 1)
  channelGroupFilter.value = 'phone'
  const base = contacts.value.filter((c) => !isCcsPhoneSession(c.id))
  contacts.value = mergeActivePhoneSessions(base)
  activeId.value = newId
  void loadThread(newId)
  void loadAgentStats()
}

function markPhoneSessionConnected(callId?: number) {
  const ids =
    callId != null
      ? [ccsPhoneSessionId(callId)]
      : [...phoneSessions.value.keys()]
  for (const id of ids) {
    const sess = phoneSessions.value.get(id)
    if (!sess) continue
    sess.contact.call_connected = true
    sess.contact.last_message = sess.contact.call_method?.includes('坐席呼坐席')
      ? `【${sess.contact.call_method}】通话中`
      : sess.contact.call_method === '外呼'
      ? '【去电】通话中'
      : `【${sess.contact.call_method || '来电'}】通话中`
    phoneSessions.value.set(id, { ...sess, contact: { ...sess.contact } })
  }
  contacts.value = mergeActivePhoneSessions(contacts.value.filter((c) => !isCcsPhoneSession(c.id)))
}

function callKindOf(c: Contact): 'inbound' | 'outbound' | 'transfer' | 'agent' | 'supervisor' {
  const m = (c.call_method || c.tags?.[0] || '').trim()
  if (m === '强插' || m === '监听' || m === '拦截') return 'supervisor'
  if (m.includes('坐席呼坐席')) return 'agent'
  if (m.includes('外呼') || m.includes('去电')) return 'outbound'
  if (m.includes('转')) return 'transfer'
  return 'inbound'
}

function callKindTitle(c: Contact) {
  const k = callKindOf(c)
  if (k === 'supervisor') return c.call_method || '质检'
  if (k === 'agent') return c.call_method || '坐席呼坐席'
  if (k === 'outbound') return '外呼'
  if (k === 'transfer') return '转接'
  return '来电'
}

function callKindIcon(c: Contact) {
  const k = callKindOf(c)
  if (k === 'supervisor') return UserFilled
  if (k === 'agent') return UserFilled
  if (k === 'outbound') return PhoneFilled
  if (k === 'transfer') return Switch
  return Phone
}

function callConnectedState(c: Contact): boolean | null {
  if (!isPhoneContact(c)) return null
  if (typeof c.call_connected === 'boolean') return c.call_connected
  if (c.omni_lifecycle === 'active' && isCcsPhoneSession(c.id)) return false
  if (typeof c.talk_time_sec === 'number') return c.talk_time_sec > 0
  return null
}

function handlePhoneEnded(ev: Event) {
  const callId = (ev as CustomEvent<{ CallID?: number }>).detail?.CallID
  const ids = new Set<string>([ccsPhoneSessionId(0)])
  if (callId != null) ids.add(ccsPhoneSessionId(callId))
  if (![...ids].some((id) => phoneSessions.value.has(id))) {
    for (const id of phoneSessions.value.keys()) ids.add(id)
  }
  for (const id of ids) {
    phoneSessions.value.delete(id)
    contacts.value = contacts.value.filter((c) => c.id !== id)
  }
  const row = channelSummary.value.find((s) => s.channel_group === 'phone')
  if (row) row.unread = Math.max(0, phoneSessions.value.size)
  void loadContacts()
  void loadAgentStats()
}

function handlePhoneConversation(ev: Event) {
  if (!voiceEnabled.value) return
  const d = (ev as CustomEvent<{ call_id?: number; conversation_id?: number }>).detail
  if (!d?.conversation_id) return
  if (d.call_id != null) {
    const ephemeral = ccsPhoneSessionId(d.call_id)
    phoneSessions.value.delete(ephemeral)
    contacts.value = contacts.value.filter((c) => c.id !== ephemeral)
  }
  const nextId = `c${d.conversation_id}`
  void loadContacts().then(() => {
    activeId.value = nextId
  })
}

function contactChannelGroup(c: Contact): ChannelGroup {
  if (c.channel_group) return c.channel_group
  return isPhoneContact(c) ? 'phone' : 'media'
}

function filterContactsByChannel(list: Contact[]): Contact[] {
  return list.filter((c) => (voiceEnabled.value || !isPhoneContact(c)) && contactChannelGroup(c) === channelGroupFilter.value)
}

const pinnedIds = ref<Set<string>>(new Set())
const flaggedIds = ref<Set<string>>(new Set())
const mutedIds = ref<Set<string>>(new Set())

const sessionMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  contact: null as Contact | null,
})

interface OrderRow {
  order_no: string
  product_name: string
  store: string
  date: string
  price: string
}

interface VisitRow {
  id: string
  product_name: string
  visit_time: string
  product_link: string
}

interface ReturnVisitRow {
  id: string
  visit_time: string
  channel: string
  content: string
  result: string
  agent: string
}

interface CustomerDetail {
  id?: number
  phone: string
  name: string
  email?: string
  gender: string
  customer_type: string
  level: string
  id_number: string
  ethnicity: string
  address: string
  labels?: Array<{ id: number; title: string; color: string }>
  orders: OrderRow[]
  visits: VisitRow[]
  /** 回访记录，旧接口可能缺失 */
  return_visits?: ReturnVisitRow[]
}

const consultSub1Options = [1, 2, 3]

const consultClassOptions = [
  { value: 'product', label: '产品咨询' },
  { value: 'install', label: '安装/维修' },
  { value: 'logistics', label: '物流投诉' },
  { value: 'site_pre', label: '官网售前' },
  { value: 'site_after', label: '官网售后' },
  { value: 'ticket', label: '工单' },
  { value: 'offline_complaint', label: '线下产品投诉' },
  { value: 'laundry', label: '洗护' },
]

const consultForm = reactive({
  productMain: '',
  productCategory: 'order_center',
  customerName: '',
  phone: '',
  address: '',
  customerChannel: 'online' as 'online' | 'offline' | 'none',
  orderNo: '',
  storeName: '',
  consultClass: 'product',
  consultSub1: '',
  consultSub2: '',
  urgency: 'medium' as 'high' | 'medium' | 'low',
})

const sessionDone = ref(0)
const sessionPending = ref(0)
const dailyAnswered = ref(0)
const dailyMissed = ref(0)
const listTab = ref('customers')
const historyRange = ref<[string, string] | ''>('')
const historyExporting = ref(false)
const listQuery = ref('')
const channelGroupFilter = ref<ChannelGroup>(readWorkspaceChannelPreference(workspaceIdentity(), undefined, voiceEnabled.value))
watch(channelGroupFilter, channel => writeWorkspaceChannelPreference(workspaceIdentity(), channel))
watch(() => [accessStore.accountId, authStore.user?.id], () => {
  channelGroupFilter.value = readWorkspaceChannelPreference(workspaceIdentity(), undefined, voiceEnabled.value)
})
watch(voiceEnabled, enabled => {
  if (!enabled) {
    phoneSessions.value.clear()
    if (channelGroupFilter.value === 'phone') {
      channelGroupFilter.value = 'media'
      activeId.value = null
      void loadContacts()
    }
  }
})
const sideTab = ref('profile')

async function loadAgentStats() {
  try {
    const { data } = await api.get<{
      session_done?: number
      session_pending?: number
      answered?: number
      missed?: number
    }>('/api/omnichannel/agent-stats')
    sessionDone.value = Number(data.session_done ?? 0)
    sessionPending.value = Number(data.session_pending ?? 0)
    dailyAnswered.value = Number(data.answered ?? 0)
    dailyMissed.value = Number(data.missed ?? 0)
  } catch {
    /* ignore */
  }
}

interface CallRecordItem {
  call_id: number | null
  caller: string
  called: string
  offered_at: string | null
  offered_at_label: string
  ended_at: string | null
  ended_at_label: string
  talk_time_sec: number
  talk_time_label: string
  direction?: string
  method?: string
  method_label?: string
  hangup_reason?: string
  release_cause?: number
  connected?: boolean
  recording_path?: string | null
  has_recording?: boolean
  is_current?: boolean
  is_media?: boolean
  assignee_work_no?: string
  assignee_name?: string
  skill_group_name?: string
}

interface CallRecordEvent {
  event_type: string
  event_label?: string
  summary: string
  actor_work_no?: string
  created_at: string
  created_at_label: string
}

interface CallRecord {
  conversation_id: number
  is_voice: boolean
  caller: string
  called: string
  skill_group_name: string
  ccs_call_id: number | null
  talk_time_sec: number | null
  talk_time_label: string
  offered_at: string | null
  answered_at: string | null
  ended_at: string | null
  recording_status: string
  has_recording: boolean
  items?: CallRecordItem[]
  events?: CallRecordEvent[]
}

const callRecord = ref<CallRecord | null>(null)
const callRecordLoading = ref(false)
const callAudioUrl = ref('')
const callAudioLoading = ref(false)
const callAudioError = ref('')
const playingCallKey = ref('')
const agentPlayingKey = ref('')
const agentPlayKey = ref('')
const downloadKey = ref('')
const agentStore = useAgentStore()
const agentIm = useAgentInternalStore()
const internalActive = computed(() => agentIm.active)
const pendingRestMsg = computed(() =>
  [...(agentIm.active?.messages ?? [])].reverse().find((m) => m.kind === 'rest_request' && m.restStatus === 'pending'),
)

const restApproveVisible = ref(false)
const restApproveStatus = ref<0 | 1>(0)
const restApprovePeerId = ref<number | null>(null)
const restApproveOpinion = ref('')
const restApproveMinutes = ref(15)
const restApproveHint = ref('')
const restApproveSubmitting = ref(false)

function internalToContact(t: {
  peerAgentId: number
  workNo: string
  name: string
  kind: 'im' | 'rest_request'
  last: string
  unread: number
  messages: Array<{ ts: number }>
}): Contact {
  const lastTs = t.messages.at(-1)?.ts
  return {
    id: `im-${t.peerAgentId}`,
    name: t.name,
    code: t.workNo,
    last_message: t.last,
    time_label: lastTs
      ? new Date(lastTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : '',
    unread: t.unread,
    channels: [],
    tags: [],
    visit_count: 0,
    source: t.kind === 'rest_request' ? '申请小休' : '坐席间',
    peerAgentId: t.peerAgentId,
    internalKind: t.kind,
  }
}

async function onInternalPicked(a: { agentId: number; workNo: string; name: string }) {
  listTab.value = 'internal'
  await agentIm.openPeer(a)
  await loadContacts()
  activeId.value = `im-${a.agentId}`
  syncInternalMessages()
}

async function onRestRequestNavigate(ev: Event) {
  const detail = (ev as CustomEvent<{ srcAgentId?: number; workNo?: string; name?: string }>).detail
  const src = Number(detail?.srcAgentId || 0)
  if (!src) return
  listTab.value = 'internal'
  await agentIm.openPeer({
    agentId: src,
    workNo: String(detail?.workNo || src),
    name: String(detail?.name || detail?.workNo || src),
  })
  activeId.value = `im-${src}`
  await loadContacts()
  syncInternalMessages()
}

async function onInternalComposerSent() {
  syncInternalMessages()
  await loadContacts()
}

async function onApproveRest(status: 0 | 1) {
  const peer = agentIm.activePeerId
  if (!peer) return
  restApprovePeerId.value = peer
  restApproveStatus.value = status
  if (status === 0) {
    const defMin = agentIm.pendingRestMinutes(peer)
    restApproveMinutes.value = defMin
    restApproveOpinion.value = '同意'
    restApproveHint.value = `申请人申请 ${defMin} 分钟，可在下方调整允许时长`
  } else {
    restApproveMinutes.value = 15
    restApproveOpinion.value = ''
    restApproveHint.value = ''
  }
  restApproveVisible.value = true
}

function onRestApproveClosed() {
  restApproveSubmitting.value = false
}

async function submitRestApprove() {
  const peer = restApprovePeerId.value
  if (!peer) return
  const status = restApproveStatus.value
  let opinion = restApproveOpinion.value.trim()
  if (status === 1 && !opinion) {
    ElMessage.warning('请填写拒绝原因')
    return
  }
  if (!opinion) opinion = status === 0 ? '同意' : '拒绝'
  const durationSec =
    status === 0
      ? Math.min(240, Math.max(1, Math.floor(Number(restApproveMinutes.value) || 15))) * 60
      : 0
  restApproveSubmitting.value = true
  try {
    await agentIm.approveRest(peer, status, opinion, durationSec)
    restApproveVisible.value = false
    ElMessage.success(status === 0 ? '已同意小休' : '已拒绝')
    await loadContacts()
    syncInternalMessages()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '审批失败')
  } finally {
    restApproveSubmitting.value = false
  }
}

function syncInternalMessages() {
  const th = agentIm.active
  if (!th) {
    messages.value = []
    return
  }
  const mine = agentStore.agentId
  messages.value = th.messages
    .filter((m) => m.text || m.media)
    .map((m) => {
      const media = m.media
      const kind = media?.kind === 'image' || media?.kind === 'video' || media?.kind === 'file'
        ? media.kind
        : ('text' as const)
      return {
        id: m.id,
        from: m.fromAgentId === mine ? 'agent' : 'customer',
        kind: m.kind === 'rest_request' ? 'text' : kind,
        text:
          m.kind === 'rest_request'
            ? `[小休申请] ${m.text}`
            : media
              ? m.text || undefined
              : m.text,
        file_url: media?.file_url,
        file_name: media?.file_name,
        content_type: media?.content_type,
        byte_size: media?.byte_size,
        time: new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        day: '',
      }
    })
}

function callRowKey(row: CallRecordItem) {
  return `${row.caller}|${row.called}|${row.offered_at || ''}`
}

function revokeCallAudio() {
  if (callAudioUrl.value) {
    URL.revokeObjectURL(callAudioUrl.value)
    callAudioUrl.value = ''
  }
  playingCallKey.value = ''
}

const callRecordStatusLabel = computed(() => {
  if (!callRecord.value) return '—'
  if (callRecord.value.has_recording) return '可回听'
  if (callRecord.value.recording_status === 'pending') return '生成中'
  return '无录音'
})

const callRecordMethodLabel = computed(() => {
  const items = callRecordItems.value
  const current = items.find((it) => it.is_current) || items[0]
  return current?.method_label || current?.method || '—'
})

const callRecordItems = computed<CallRecordItem[]>(() => {
  const rec = callRecord.value
  if (rec?.items?.length) return rec.items
  return []
})

const playingCallLabel = computed(() => {
  const row = callRecordItems.value.find((it) => callRowKey(it) === playingCallKey.value)
  if (!row) return ''
  return `${row.offered_at_label || ''} ${row.caller || ''}`.trim()
})

function formatLocalDateTime(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function loadCallRecord() {
  const id = activeConversationId.value
  const phone = activeContact.value?.code?.trim() || ''
  if (!id && !phone) {
    callRecord.value = null
    revokeCallAudio()
    return
  }
  callRecordLoading.value = true
  callAudioError.value = ''
  try {
    if (id) {
      const { data } = await api.get<CallRecord>(`/api/omnichannel/sessions/c${id}/call-record`)
      callRecord.value = data
      if (!data.has_recording) revokeCallAudio()
      return
    }
    const { data } = await api.get<{ items: CallRecordItem[] }>('/api/omnichannel/call-records', {
      params: { phone },
    })
    callRecord.value = {
      conversation_id: 0,
      is_voice: true,
      caller: phone,
      called: '',
      skill_group_name: '',
      ccs_call_id: null,
      talk_time_sec: null,
      talk_time_label: '',
      offered_at: null,
      answered_at: null,
      ended_at: null,
      recording_status: (data.items ?? []).some((it) => it.has_recording) ? 'ready' : 'none',
      has_recording: (data.items ?? []).some((it) => it.has_recording),
      items: data.items ?? [],
    }
    revokeCallAudio()
  } catch {
    callRecord.value = null
  } finally {
    callRecordLoading.value = false
  }
}

function recordingRequest(row: CallRecordItem, download = false) {
  const id = activeConversationId.value
  const params: Record<string, string | number> = {
    caller: row.caller || '',
    called: row.called || '',
    offered_at: row.offered_at || '',
  }
  if (download) params.download = 1
  return {
    url: id ? `/api/omnichannel/sessions/c${id}/recording` : '/api/omnichannel/recordings',
    params,
  }
}

async function fetchRecordingBlob(row: CallRecordItem, download = false) {
  const { url, params } = recordingRequest(row, download)
  const { data } = await api.get<Blob>(url, {
    responseType: 'blob',
    params,
    timeout: 60000,
  })
  if (data.type && data.type.includes('json')) {
    const text = await data.text()
    let msg = '录音读取失败'
    try {
      msg = JSON.parse(text).error || msg
    } catch { /* keep default */ }
    throw new Error(msg)
  }
  return data
}

async function playLocal(row: CallRecordItem) {
  if (!row.has_recording) return
  playingCallKey.value = callRowKey(row)
  callAudioLoading.value = true
  callAudioError.value = ''
  try {
    const data = await fetchRecordingBlob(row)
    revokeCallAudio()
    callAudioUrl.value = URL.createObjectURL(data)
  } catch (e) {
    revokeCallAudio()
    callAudioError.value = e instanceof Error ? e.message : '录音读取失败'
  } finally {
    callAudioLoading.value = false
  }
}

async function downloadRecording(row: CallRecordItem) {
  if (!row.has_recording) return
  downloadKey.value = callRowKey(row)
  callAudioError.value = ''
  try {
    const data = await fetchRecordingBlob(row, true)
    const href = URL.createObjectURL(data)
    const stamp = (row.offered_at_label || 'call').replace(/[: ]/g, '-')
    const a = document.createElement('a')
    a.href = href
    a.download = `${row.caller || 'unknown'}-${row.called || 'unknown'}-${stamp}.wav`
    a.click()
    URL.revokeObjectURL(href)
  } catch (e) {
    callAudioError.value = e instanceof Error ? e.message : '录音下载失败'
    ElMessage.error(callAudioError.value)
  } finally {
    downloadKey.value = ''
  }
}

async function playOnAgent(row: CallRecordItem) {
  if (!row.has_recording || !row.recording_path) {
    ElMessage.warning('无录音')
    return
  }
  if (!agentStore.agentId) {
    ElMessage.warning('请先话务签入后再使用坐席播放')
    return
  }
  agentPlayKey.value = callRowKey(row)
  callAudioError.value = ''
  try {
    const ack = await agentStore.invokeAgent('DoAgentPlayFile', { FileName: row.recording_path })
    const rc = Number(ack.Result ?? 0)
    if (rc !== 0) {
      const msg = String(ack.errMsg || '')
      if (rc === -2 || /no channel/i.test(msg)) {
        throw new Error('坐席分机当前无通话通道，无法坐席播放')
      }
      throw new Error(formatCcsError(rc, msg) || '坐席播放失败')
    }
    agentPlayingKey.value = callRowKey(row)
    ElMessage.success('已在坐席分机播放')
  } catch (e) {
    const msg = e instanceof Error ? e.message : '坐席播放失败'
    callAudioError.value = msg
    ElMessage.error(msg)
  } finally {
    agentPlayKey.value = ''
  }
}

async function stopAgentPlay() {
  try {
    await agentStore.invokeAgent('DoAgentStopPlayFile', {})
  } catch {
    /* ignore */
  }
  agentPlayingKey.value = ''
}
const contacts = ref<Contact[]>([])
const activeId = ref<string | null>(null)
const messages = ref<ThreadMsg[]>([])
const customerDetail = ref<CustomerDetail | null>(null)
const crmSaving = ref(false)
const crmLabelOptions = ref<CrmLabel[]>([])
const crmSideLabelIds = ref<number[]>([])

async function ensureCrmLabels() {
  if (crmLabelOptions.value.length) return
  try {
    crmLabelOptions.value = await fetchCrmLabels()
  } catch {
    crmLabelOptions.value = []
  }
}

async function saveCrmSideProfile() {
  const c = customerDetail.value
  if (!c?.id) {
    ElMessage.warning('当前会话无绑定客户档案')
    return
  }
  crmSaving.value = true
  try {
    await patchCustomer(c.id, {
      name: c.name,
      phone: c.phone,
      email: c.email || null,
      location: c.address,
      gender: c.gender,
      customer_type: c.customer_type,
      level: c.level,
    })
    await putCustomerLabels(c.id, crmSideLabelIds.value)
    ElMessage.success('客户资料已保存')
  } catch {
    ElMessage.error('保存失败')
  } finally {
    crmSaving.value = false
  }
}
const threadEl = ref<HTMLElement | null>(null)
const chatPanelEl = ref<HTMLElement | null>(null)

provide(SCREENSHOT_HIDE_TARGET, chatPanelEl)
provide(SCREENSHOT_LONG_TARGET, threadEl)

const listPanelWidth = ref(LIST_PANEL_DEFAULT)
const listResizing = ref(false)
const sidePanelWidth = ref(SIDE_PANEL_DEFAULT)
const sideResizing = ref(false)
const omniGridColumns = computed(
  () => `${listPanelWidth.value}px 8px 1fr 8px ${sidePanelWidth.value}px`,
)

function clampListWidth(w: number) {
  return Math.min(LIST_PANEL_MAX, Math.max(LIST_PANEL_MIN, Math.round(w)))
}

function clampSideWidth(w: number) {
  return Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, Math.round(w)))
}

function onListResizeStart(e: MouseEvent) {
  const startX = e.clientX
  const startW = listPanelWidth.value
  listResizing.value = true
  const onMove = (ev: MouseEvent) => {
    listPanelWidth.value = clampListWidth(startW + (ev.clientX - startX))
  }
  const onUp = () => {
    listResizing.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

function onSideResizeStart(e: MouseEvent) {
  const startX = e.clientX
  const startW = sidePanelWidth.value
  sideResizing.value = true
  const onMove = (ev: MouseEvent) => {
    sidePanelWidth.value = clampSideWidth(startW - (ev.clientX - startX))
  }
  const onUp = () => {
    sideResizing.value = false
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
}

interface AfterSalesRow {
  product_category: string
  file_no: string
  description: string
}

const afterPhoneQuery = ref('')
const afterSalesRows = ref<AfterSalesRow[]>([])
const afterSalesLoading = ref(false)

interface EcomLogisticsStep {
  time: string
  location: string
  text: string
  active?: boolean
}

interface EcomOrderCard {
  order_no: string
  status: string
  shop_name: string
  order_date: string
  platform: string
  recipient: string
  address: string
  delivery_date: string
  amount: string
  phone: string
  product_model: string
  invoice_no: string
  tracking_no: string
  logistics: EcomLogisticsStep[]
}

const ecomQuery = ref('')
const ecomOrders = ref<EcomOrderCard[]>([])
const ecomLoading = ref(false)

const channelSummary = ref<ChannelSummaryRow[]>([
  { channel_group: 'media', label: '多媒体', icon: markRaw(ChatDotRound), unread: 0 },
  { channel_group: 'phone', label: '电话', icon: markRaw(Phone), unread: 0 },
])

const visibleChannelSummary = computed(() => channelSummary.value.filter(s => s.channel_group !== 'phone' || voiceEnabled.value))

function applyChannelSummaryFromApi(
  rows?: Array<{ channel_group: ChannelGroup; unread: number }>,
) {
  if (!rows?.length) return
  channelSummary.value = [
    {
      channel_group: 'media',
      label: '多媒体',
      icon: markRaw(ChatDotRound),
      unread: rows.find((r) => r.channel_group === 'media')?.unread ?? 0,
    },
    {
      channel_group: 'phone',
      label: '电话',
      icon: markRaw(Phone),
      unread: rows.find((r) => r.channel_group === 'phone')?.unread ?? 0,
    },
  ]
}

function adjustChannelSummaryUnread(group: ChannelGroup, delta: number) {
  if (!delta) return
  const row = channelSummary.value.find((s) => s.channel_group === group)
  if (row) row.unread = Math.max(0, row.unread + delta)
}

function selectChannelGroupFilter(group: ChannelGroup) {
  if (group === 'phone' && !voiceEnabled.value) return
  if (channelGroupFilter.value === group) return
  channelGroupFilter.value = group
  void loadContacts()
}

const activeContact = computed(() => contacts.value.find((c) => c.id === activeId.value) ?? null)

const isPhoneSession = computed(() => {
  const c = activeContact.value
  return c ? isPhoneContact(c) : false
})

const showLiveCaptions = computed(() => {
  if (listTab.value !== 'customers' || !isPhoneSession.value) return false
  if (agentStore.liveCaptionsHidden) return false
  return agentStore.liveCaptions.length > 0
})

const showLiveCaptionsRestore = computed(() => {
  if (listTab.value !== 'customers' || !isPhoneSession.value) return false
  if (!agentStore.liveCaptionsHidden) return false
  return agentStore.liveCaptions.length > 0
})

const desktopMedia = useDesktopCallMediaStore()
const activeVideoCall = computed(() => {
  const current = desktopMedia.call
  if (listTab.value !== 'customers' || !isPhoneSession.value || !current) return null
  if (!desktopMedia.isVideoCall) return null
  return desktopMedia.matchesSession(activeId.value, activeConversationId.value) ? current : null
})

const isSessionEnded = computed(() => activeContact.value?.omni_lifecycle === 'ended')

/** 转接后源坐席 CallEnd 曾误标会话 ended，但 CCS 仍为通话——工具栏以话务相位兜底 */
const showPhoneCallToolbar = computed(() => {
  if (!isPhoneSession.value || listTab.value !== 'customers') return false
  const phase = agentStore.callPhase
  if (phase === 'talking' || phase === 'held' || phase === 'ringing') return true
  return !isSessionEnded.value
})

const showMediaSessionToolbar = computed(() => {
  if (listTab.value !== 'customers' || !activeContact.value) return false
  if (isPhoneSession.value) return false
  return !isSessionEnded.value
})

function lifecycleLabel(c: Contact): string {
  if (c.omni_lifecycle !== 'ended') {
    return isPhoneContact(c) && isCcsPhoneSession(c.id) ? '通话中' : ''
  }
  return isPhoneContact(c) ? '已挂机待完成' : '待完成'
}

const phoneToolbarRef = ref<InstanceType<typeof PhoneCallToolbar> | null>(null)

const sessionElapsed = ref(0)
let sessionTick: ReturnType<typeof setInterval> | null = null

function formatSessionTimer(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

const sessionTimerText = computed(() => formatSessionTimer(sessionElapsed.value))

function stopSessionTimer() {
  if (sessionTick) {
    clearInterval(sessionTick)
    sessionTick = null
  }
}

function startSessionTimerIfNeeded() {
  stopSessionTimer()
  sessionElapsed.value = 0
  if (listTab.value !== 'customers' || !activeId.value) return
  sessionTick = setInterval(() => {
    sessionElapsed.value += 1
  }, 1000)
}

watch([activeId, listTab], () => {
  startSessionTimerIfNeeded()
})

watch(activeId, () => {
  revokeCallAudio()
  callRecord.value = null
  if (sideTab.value === 'call') void loadCallRecord()
})

const activeConversationId = computed(() => {
  const c = activeContact.value
  if (!c) return null
  const id = c.conversation_id ?? parseInt(c.id.replace(/^c/, ''), 10)
  return Number.isFinite(id) ? id : null
})

const sideTabLabelMap: Record<string, string> = {
  call: '通话记录',
  after: '售后工单',
  ecom: '电商订单',
  canned: '快捷回复',
  leave: '在线留言',
  kb: '知识库',
  more_contact_history: '接触历史',
  more_ecom_query: '电商订单查询',
  more_mall_order: '商城订单信息',
  more_sales_volume: '客服销售量',
  more_spare_parts: '备件信息查询',
  more_equipment_file: '设备档案查询',
}
const sideTabLabel = computed(() => sideTabLabelMap[sideTab.value] ?? '此页')

const isMorePanelActive = computed(() => sideTab.value.startsWith('more_'))

/** 选中「全部」子菜单时不在左侧 Tabs 上高亮具体项 */
const sideTabsNavName = computed(() =>
  sideTab.value.startsWith('more_') ? undefined : (sideTab.value as string),
)

function onSideMainTabClick(pane: { paneName: string | number }) {
  sideTab.value = String(pane.paneName)
}

function onMoreMenuCommand(command: string) {
  if (command === 'itr_start') {
    void startItrFlow()
    return
  }
  if (command === 'media_transfer') {
    if (typeof phoneToolbarRef.value?.openTransfer === 'function') {
      phoneToolbarRef.value.openTransfer('agent_release')
    } else {
      void transferMediaSession()
    }
    return
  }
  if (command === 'csat_invite') {
    void inviteCsat()
    return
  }
  sideTab.value = command
}

const groupedMessages = computed(() => {
  const map = new Map<string, ThreadMsg[]>()
  for (const m of messages.value) {
    const arr = map.get(m.day) ?? []
    arr.push(m)
    map.set(m.day, arr)
  }
  return [...map.entries()].map(([date, items]) => ({ date, items }))
})

/**
 * 会话列表头像的底色按来源渠道区分。
 * 之前所有头像都是 el-avatar 的默认灰（#c0c4cc），坐席一眼分不出客户从哪个渠道来，
 * 灰色还容易被误读成"非法/已失效"。
 */
function avatarClass(c: Contact): string {
  const ch = (c.channels ?? [])[0]
  return ch ? `av-${ch}` : 'av-web'
}

function applyCustomerToConsultForm() {
  const c = customerDetail.value
  if (!c) return
  consultForm.customerName = c.name
  consultForm.phone = c.phone
  consultForm.address = c.address
}

function onAddTemplate() {
  ElMessage.info('可在此弹出模板选择或上传对话框')
}

function onConsultSubmit() {
  ElMessage.success('咨询工单已提交（演示）')
}

function onConsultSave() {
  ElMessage.success('已保存草稿（演示）')
}

watch([customerDetail, sideTab], () => {
  if (sideTab.value === 'consult') applyCustomerToConsultForm()
})

const defaultAfterSalesRows: AfterSalesRow[] = [
  {
    product_category: '家用空调',
    file_no: 'JR18037025959',
    description: 'KFR-35GW/BP3DN8Y-YA102(B1) 变频分体挂壁式空调',
  },
  {
    product_category: '洗衣机',
    file_no: 'JR18037025959',
    description: 'MG100V331WDY 滚筒全自动洗衣机 10kg',
  },
  {
    product_category: '油机',
    file_no: 'JR18037025959',
    description: 'CXW-280-J57 家用侧吸式油烟机',
  },
  {
    product_category: '电饭煲',
    file_no: 'JR18037025959',
    description: 'MB-FB50S701 智能 IH 电饭煲 5L',
  },
]

async function loadAfterSales() {
  afterSalesLoading.value = true
  try {
    const { data } = await api.get<{ items: AfterSalesRow[] }>('/api/omnichannel/after-sales', {
      params: { phone: afterPhoneQuery.value.trim() || undefined },
    })
    afterSalesRows.value = data.items
  } catch {
    afterSalesRows.value = defaultAfterSalesRows
  } finally {
    afterSalesLoading.value = false
  }
}

function openAfterFile(row: AfterSalesRow) {
  ElMessage.info(`打开档案 ${row.file_no}（可对接详情页）`)
}

const defaultEcomOrders: EcomOrderCard[] = [
  {
    order_no: 'JD2018031508821',
    status: '已收货',
    shop_name: '美的京东自营旗舰店',
    order_date: '2018-03-15',
    platform: '京东商城',
    recipient: '刘先生',
    address: '广东省佛山市顺德区北滘镇美的全球创新中心A座',
    delivery_date: '2018-03-18',
    amount: '¥ 3299.00',
    phone: '13800138000',
    product_model: 'KFR-35GW/BP3DN8Y-YA102(B1)',
    invoice_no: 'FP-20180318-00921',
    tracking_no: 'SF1029384756211',
    logistics: [
      {
        time: '2018-03-18 14:25',
        location: '佛山市',
        text: '包裹已由本人签收，签收人凭取货码签收。感谢使用顺丰，期待再次为您服务。',
        active: true,
      },
      {
        time: '2018-03-18 08:10',
        location: '佛山市',
        text: '快件到达 【佛山顺德分拨中心】',
      },
      {
        time: '2018-03-17 21:30',
        location: '广州市',
        text: '快件离开 【广州转运中心】 发往佛山',
      },
    ],
  },
  {
    order_no: 'JD2018031005560',
    status: '已收货',
    shop_name: '小天鹅官方旗舰店',
    order_date: '2018-03-10',
    platform: '京东商城',
    recipient: '刘先生',
    address: '广东省佛山市顺德区北滘镇美的全球创新中心A座',
    delivery_date: '2018-03-14',
    amount: '¥ 2199.00',
    phone: '13800138000',
    product_model: 'MG100V331WDY',
    invoice_no: 'FP-20180312-00788',
    tracking_no: 'JDVP883921004',
    logistics: [
      {
        time: '2018-03-14 16:02',
        location: '佛山市',
        text: '您的订单已由京东快递投递完成，请确认商品完好。',
        active: true,
      },
      {
        time: '2018-03-14 09:00',
        location: '佛山市',
        text: '快递员 【王师傅 138****6677】 正在派送途中',
      },
    ],
  },
]

async function loadEcomOrders() {
  ecomLoading.value = true
  try {
    const { data } = await api.get<{ items: EcomOrderCard[] }>('/api/omnichannel/ecom-orders', {
      params: { q: ecomQuery.value.trim() || undefined },
    })
    ecomOrders.value = data.items
  } catch {
    ecomOrders.value = defaultEcomOrders
  } finally {
    ecomLoading.value = false
  }
}

watch(sideTab, (tab) => {
  if (tab === 'call') {
    void loadCallRecord()
    return
  }
  if (tab === 'after') {
    if (customerDetail.value?.phone && !afterPhoneQuery.value.trim()) {
      afterPhoneQuery.value = customerDetail.value.phone
    }
    loadAfterSales()
    return
  }
  if (tab === 'ecom') {
    if (customerDetail.value?.phone && !ecomQuery.value.trim()) {
      ecomQuery.value = customerDetail.value.phone
    }
    loadEcomOrders()
    return
  }
  if (tab === 'kb') {
    return
  }
  if (tab === 'canned') {
    void loadCanned()
    return
  }
  if (tab === 'leave') {
    void loadLeaveMessages()
  }
})

async function exportHistory() {
  historyExporting.value = true
  try {
    const { data } = await api.get('/api/omnichannel/contacts/export.csv', {
      params: {
        tab: 'history',
        q: listQuery.value || undefined,
        channel_group: channelGroupFilter.value,
        from: historyRange.value ? historyRange.value[0] : undefined,
        to: historyRange.value ? historyRange.value[1] : undefined,
      },
      responseType: 'blob',
    })
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `omni-history-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出历史会话')
  } catch {
    ElMessage.error('导出失败')
  } finally {
    historyExporting.value = false
  }
}

const chatComposerRef = ref<{ setDraft?: (t: string) => void; appendDraft?: (t: string) => void } | null>(null)
const cannedLoading = ref(false)
const cannedItems = ref<Array<{ id: number; short_code?: string; content: string }>>([])
const leaveLoading = ref(false)
const leaveItems = ref<
  Array<{ id: string; conversationId: number; content: string; createdAt: string; status: string }>
>([])

async function loadCanned() {
  cannedLoading.value = true
  try {
    const { data } = await api.get('/api/v1/accounts/1/canned_responses')
    cannedItems.value = Array.isArray(data) ? data : []
  } catch {
    cannedItems.value = []
  } finally {
    cannedLoading.value = false
  }
}

function insertCanned(item: { content: string }) {
  chatComposerRef.value?.setDraft?.(item.content || '')
  ElMessage.success('已填入输入框')
}

async function loadLeaveMessages() {
  leaveLoading.value = true
  try {
    const { data } = await api.get<{ items: typeof leaveItems.value }>('/api/itr/leave-messages')
    leaveItems.value = data.items || []
  } catch {
    leaveItems.value = []
  } finally {
    leaveLoading.value = false
  }
}

async function claimLeave(item: { id: string; conversationId?: number }) {
  const assigneeId = authStore.user?.id
  if (!assigneeId) {
    ElMessage.warning('未登录，无法认领')
    return
  }
  await api.post(`/api/itr/leave-messages/${item.id}/claim`, { assigneeId })
  ElMessage.success('已认领并接入会话')
  void loadLeaveMessages()
  if (item.conversationId) {
    await openAssignedConversation(item.conversationId)
  }
}

async function startItrFlow() {
  const id = activeConversationId.value
  if (!id) {
    ElMessage.warning('请先选择会话')
    return
  }
  try {
    const { data } = await api.post('/api/itr/sessions/start', {
      conversationId: String(id),
      channelType: 'web_widget',
    })
    ElMessage.success(`ITR 已启动：${(data as { state?: string }).state || 'ok'}`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '启动 ITR 失败（请确认 ITRPython 已启动）')
  }
}

const xferVisible = ref(false)
const xferForm = reactive({
  mode: 'agent' as 'agent' | 'skill',
  assigneeId: '',
  vdnId: 1,
  agentGroupId: -1,
  skillId: -1,
})

async function transferMediaSession() {
  const id = activeConversationId.value
  if (!id) {
    ElMessage.warning('请先选择会话')
    return
  }
  xferForm.mode = 'agent'
  xferForm.assigneeId = ''
  xferVisible.value = true
}

async function submitMediaTransfer() {
  const id = activeConversationId.value
  if (!id) return
  try {
    if (xferForm.mode === 'agent') {
      const assigneeId = Number(xferForm.assigneeId)
      if (!assigneeId) {
        ElMessage.warning('请输入目标坐席用户 ID')
        return
      }
      await api.post(`/api/omnichannel/sessions/${id}/transfer`, {
        mode: 'agent',
        assigneeId,
      })
    } else {
      await api.post(`/api/omnichannel/sessions/${id}/transfer`, {
        mode: 'skill',
        vdnId: xferForm.vdnId,
        agentGroupId: xferForm.agentGroupId,
        skillId: xferForm.skillId,
      })
    }
    xferVisible.value = false
    ElMessage.success(xferForm.mode === 'agent' ? '已转接' : '已按技能重新排队')
    void refreshQueueStatus()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '转接失败')
  }
}

async function leaveQueue() {
  const id = activeConversationId.value
  if (!id) return
  try {
    await api.post(`/api/omnichannel/sessions/${id}/leave-queue`)
    ElMessage.success('已取消排队')
    void refreshQueueStatus()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '取消排队失败')
  }
}

async function inviteCsat() {
  const id = activeConversationId.value
  if (!id) {
    ElMessage.warning('请先选择会话')
    return
  }
  try {
    await api.post('/api/itr/csat/invite', { conversationId: String(id) })
    ElMessage.success('已发送满意度邀请，访客回复 1–5 或「满意/不满意」即可落库')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发送失败')
  }
}

const queueStatus = ref<{
  queued: boolean
  waitedMs?: number
  ewt?: number | null
  queueLen?: number | null
  position?: number | null
} | null>(null)
let queuePollTimer: ReturnType<typeof setInterval> | null = null

const queueWaitLabel = computed(() => {
  const ms = queueStatus.value?.waitedMs ?? 0
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
})

async function refreshQueueStatus() {
  const id = activeConversationId.value
  if (!id || !productModules.enabled('itr')) {
    queueStatus.value = null
    return
  }
  try {
    const { data } = await api.get<{
      queued: boolean
      waitedMs?: number
      ewt?: number | null
      queueLen?: number | null
      position?: number | null
    }>(`/api/itr/queue-status/${id}`)
    queueStatus.value = data
  } catch {
    queueStatus.value = null
  }
}

function startQueuePoll() {
  if (queuePollTimer) clearInterval(queuePollTimer)
  void refreshQueueStatus()
  queuePollTimer = setInterval(() => void refreshQueueStatus(), 3000)
}

watch(activeConversationId, () => {
  startQueuePoll()
})


async function loadContacts() {
  if (listTab.value === 'internal') {
    agentIm.wireEvents()
    await agentIm.refresh()
    const q = listQuery.value.trim().toLowerCase()
    let items = agentIm.threads.map(internalToContact)
    if (q) {
      items = items.filter(
        (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.last_message.includes(q),
      )
    }
    contacts.value = items
    const stillVisible = items.some((c) => c.id === activeId.value)
    if (!stillVisible) activeId.value = items[0]?.id ?? null
    if (activeId.value?.startsWith('im-')) {
      const peer = Number(activeId.value.slice(3))
      agentIm.activePeerId = peer
      syncInternalMessages()
    }
    return
  }
  try {
    const { data } = await api.get<{
      items: Contact[]
      channel_summary?: Array<{ channel_group: ChannelGroup; unread: number }>
    }>('/api/omnichannel/contacts', {
      params: {
        q: listQuery.value || undefined,
        tab: listTab.value,
        channel_group: channelGroupFilter.value,
        from: listTab.value === 'history' && historyRange.value ? historyRange.value[0] : undefined,
        to: listTab.value === 'history' && historyRange.value ? historyRange.value[1] : undefined,
      },
    })
    const isCustomers = listTab.value === 'customers'
    const mapped = data.items.map((c) => {
      if (!isCustomers || c.id === activeId.value) return { ...c, unread: 0 }
      return c
    })
    applyChannelSummaryFromApi(data.channel_summary)
    let items = filterContactsByChannel(mapped)
    items = mergeActivePhoneSessions(items)
    contacts.value = items
    const stillVisible = items.some((c) => c.id === activeId.value)
    if (!stillVisible) {
      activeId.value = items[0]?.id ?? null
    } else if (!activeId.value && items.length) {
      activeId.value = items[0].id
    }
  } catch {
    const fallbackMedia: Contact = {
      id: '1',
      name: '访客用户',
      code: '10010',
      last_message: '您好，请问有什么可以帮您？',
      time_label: '11:28',
      unread: 0,
      channels: ['web'],
      tags: [],
      visit_count: 1,
      source: '网站 - 在线客服',
    }
    const fallbackSummary = [
      { channel_group: 'media' as const, unread: fallbackMedia.unread },
      { channel_group: 'phone' as const, unread: 0 },
    ]
    applyChannelSummaryFromApi(fallbackSummary)
    contacts.value =
      channelGroupFilter.value === 'phone'
        ? mergeActivePhoneSessions([])
        : [fallbackMedia]
    activeId.value = contacts.value[0]?.id ?? null
  }
}

async function loadThread(id: string) {
  if (isCcsPhoneSession(id)) {
    const sess = phoneSessions.value.get(id)
    messages.value = sess ? [...sess.messages] : []
    await nextTick()
    if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
    return
  }
  try {
    const { data } = await api.get<{ messages: ThreadMsg[] }>(`/api/omnichannel/sessions/${id}/messages`)
    messages.value = data.messages
  } catch {
    messages.value = []
  }
  await nextTick()
  if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
}

async function loadCustomer(id: string) {
  if (isCcsPhoneSession(id)) {
    const sess = phoneSessions.value.get(id)
    const phone = sess?.contact.code ?? ''
    customerDetail.value = {
      phone,
      name: phone || '来电客户',
      email: '',
      gender: '—',
      customer_type: '来电客户',
      level: '—',
      id_number: '—',
      ethnicity: '—',
      address: '—',
      orders: [],
      visits: [],
      return_visits: [],
    }
    crmSideLabelIds.value = []
    return
  }
  try {
    await ensureCrmLabels()
    const { data } = await api.get<CustomerDetail & { labels?: CrmLabel[] }>(
      `/api/omnichannel/customers/${id}`,
    )
    customerDetail.value = {
      ...data,
      email: data.email ?? '',
      return_visits: data.return_visits ?? [],
    }
    crmSideLabelIds.value = (data.labels ?? []).map((l) => l.id)
  } catch {
    customerDetail.value = {
      phone: '',
      name: '访客',
      email: '',
      gender: '未知',
      customer_type: '普通客户',
      level: '普通',
      id_number: '',
      ethnicity: '',
      address: '',
      orders: [],
      visits: [],
      return_visits: [],
    }
    crmSideLabelIds.value = []
  }
}

const displayContacts = computed(() => {
  const list = [...contacts.value]
  list.sort((a, b) => {
    const aPin = pinnedIds.value.has(a.id) ? 1 : 0
    const bPin = pinnedIds.value.has(b.id) ? 1 : 0
    if (aPin !== bPin) return bPin - aPin
    return 0
  })
  return list
})

function loadPinnedIds() {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    if (!raw) return
    const ids = JSON.parse(raw) as string[]
    pinnedIds.value = new Set(ids)
  } catch {
    pinnedIds.value = new Set()
  }
}

function savePinnedIds() {
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...pinnedIds.value]))
}

function isPinned(id: string) {
  return pinnedIds.value.has(id)
}

function isFlagged(id: string) {
  return flaggedIds.value.has(id)
}

function getConversationId(contact: Contact): number | null {
  if (contact.conversation_id) return contact.conversation_id
  const m = contact.id.match(/^c(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

function clearContactUnreadLocal(id: string) {
  const contact = contacts.value.find((c) => c.id === id)
  if (!contact || !contact.unread) return
  adjustChannelSummaryUnread(contact.channel_group ?? 'media', -contact.unread)
  contact.unread = 0
}

function applyUnreadChanged(data: {
  conversation_id: number
  unread: number
  last_activity_at?: number | null
}) {
  if (listTab.value !== 'customers') return
  const id = `c${data.conversation_id}`
  const contact = contacts.value.find((c) => c.id === id)
  if (!contact) {
    void loadContacts()
    return
  }
  const group: ChannelGroup = contact.channel_group ?? 'media'
  const nextUnread = id === activeId.value ? 0 : data.unread
  adjustChannelSummaryUnread(group, nextUnread - contact.unread)
  contact.unread = nextUnread
}

async function markContactAsRead(id: string) {
  clearContactUnreadLocal(id)
  const contact = contacts.value.find((c) => c.id === id)
  const convId = contact ? getConversationId(contact) : null
  if (!convId) return
  try {
    await updateConversationLastSeen(convId)
  } catch {
    // 列表仍按本地已读展示，下次刷新会与服务端对齐
  }
}

function removeContactFromList(contact: Contact) {
  if (contact.unread) {
    adjustChannelSummaryUnread(contact.channel_group ?? 'media', -contact.unread)
  }
  const idx = contacts.value.findIndex((c) => c.id === contact.id)
  if (idx >= 0) contacts.value.splice(idx, 1)
  if (activeId.value === contact.id) {
    activeId.value = null
  }
}

async function markConversationDone(contact: Contact) {
  const convId = getConversationId(contact)
  if (!convId) {
    ElMessage.error('无法识别会话 ID')
    return
  }
  try {
    await toggleConversationStatus(convId, 'resolved')
    removeContactFromList(contact)
    ElMessage.success('已完成，可在「历史会话」中查看')
    void loadAgentStats()
  } catch {
    ElMessage.error('完成会话失败')
  }
}

function closeSessionMenu() {
  sessionMenu.visible = false
  sessionMenu.contact = null
}

function openSessionMenu(e: MouseEvent, contact: Contact) {
  sessionMenu.x = e.clientX
  sessionMenu.y = e.clientY
  sessionMenu.contact = contact
  sessionMenu.visible = true
}

function onDocumentClickForMenu() {
  if (sessionMenu.visible) closeSessionMenu()
}

async function runSessionMenu(command: string) {
  const contact = sessionMenu.contact
  closeSessionMenu()
  if (!contact) return

  const convId = getConversationId(contact)

  switch (command) {
    case 'pin': {
      if (pinnedIds.value.has(contact.id)) {
        pinnedIds.value.delete(contact.id)
        ElMessage.success('已取消置顶')
      } else {
        pinnedIds.value.add(contact.id)
        ElMessage.success('已置顶')
      }
      pinnedIds.value = new Set(pinnedIds.value)
      savePinnedIds()
      break
    }
    case 'unread': {
      if (!convId) {
        ElMessage.error('无法识别会话 ID')
        return
      }
      try {
        await markConversationUnread(convId)
        if (contact.id !== activeId.value) {
          contact.unread = Math.max(contact.unread, 1)
        }
        ElMessage.success('已标为未读')
      } catch {
        ElMessage.error('标为未读失败')
      }
      break
    }
    case 'flag': {
      if (!convId) {
        ElMessage.error('无法识别会话 ID')
        return
      }
      try {
        await toggleConversationPriority(convId, 'urgent')
        if (flaggedIds.value.has(contact.id)) {
          flaggedIds.value.delete(contact.id)
          contact.flagged = false
          ElMessage.success('已取消标记')
        } else {
          flaggedIds.value.add(contact.id)
          contact.flagged = true
          ElMessage.success('已标记')
        }
        flaggedIds.value = new Set(flaggedIds.value)
      } catch {
        ElMessage.error('标记失败')
      }
      break
    }
    case 'label': {
      if (!convId) {
        ElMessage.error('无法识别会话 ID')
        return
      }
      try {
        const { value } = await ElMessageBox.prompt('请输入标签名称', '新建标签', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          inputPattern: /\S+/,
          inputErrorMessage: '标签名称不能为空',
        })
        const label = value.trim()
        await addConversationLabels(convId, [label])
        if (!contact.tags.includes(label)) {
          contact.tags.push(label)
        }
        ElMessage.success('标签已添加')
      } catch (err) {
        if (err !== 'cancel') ElMessage.error('添加标签失败')
      }
      break
    }
    case 'mute': {
      if (!convId) {
        ElMessage.error('无法识别会话 ID')
        return
      }
      try {
        await muteConversation(convId)
        mutedIds.value.add(contact.id)
        contact.muted = true
        ElMessage.success('已静音通知')
      } catch {
        ElMessage.error('静音失败')
      }
      break
    }
    case 'done':
      await markConversationDone(contact)
      break
    case 'open_nav':
      ElMessage.info('功能开发中')
      break
    case 'new_window': {
      const url = new URL(window.location.href)
      url.searchParams.set('session', contact.id)
      window.open(url.toString(), '_blank')
      break
    }
  }
}

function selectContact(id: string) {
  if (activeId.value === id) return
  activeId.value = id
  if (listTab.value === 'internal' && id.startsWith('im-')) {
    const peer = Number(id.slice(3))
    agentIm.activePeerId = peer
    void api.post(`/api/agent/internal-chats/${peer}/read`).catch(() => undefined)
    syncInternalMessages()
  }
  nextTick(() => phoneToolbarRef.value?.resetCallState())
}

async function openAssignedConversation(raw: unknown) {
  const convId = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(convId) || convId <= 0) return
  listTab.value = 'customers'
  channelGroupFilter.value = 'media'
  await loadContacts()
  selectContact(`c${convId}`)
}

async function endActiveSession() {
  const contact = activeContact.value
  if (!contact || listTab.value !== 'customers') return
  const convId = getConversationId(contact)
  if (!convId) {
    ElMessage.error('无法识别会话 ID')
    return
  }
  try {
    await ElMessageBox.confirm(
      '确定结束本次沟通？结束后客户仍在列表中，右键「完成」才会进入历史会话。',
      '结束会话',
      {
        confirmButtonText: '结束',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    await endOmniSession(contact.id)
    contact.omni_lifecycle = 'ended'
    ElMessage.success('本次沟通已结束，客户仍在列表中')
    void loadThread(contact.id)
  } catch (err) {
    if (err !== 'cancel') ElMessage.error('结束会话失败')
  }
}

function refreshThread() {
  if (activeId.value) loadThread(activeId.value)
}

function onComposerSent() {
  if (activeId.value) {
    setTimeout(() => loadThread(activeId.value!), 300)
  }
}

function onComposerClose() {
  activeId.value = null
}

watch(activeId, (id) => {
  if (!id) return
  if (listTab.value === 'internal') {
    syncInternalMessages()
    return
  }
  void markContactAsRead(id)
  loadThread(id)
  loadCustomer(id)
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(listQuery, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadContacts(), 300)
})

watch(listTab, () => {
  activeId.value = null
  void loadContacts()
})
watch(historyRange, () => {
  if (listTab.value === 'history') void loadContacts()
})

watch(
  () => agentIm.threads.map((t) => `${t.peerAgentId}:${t.unread}:${t.last}:${t.messages.length}`).join('|'),
  () => {
    if (listTab.value === 'internal') void loadContacts()
  },
)

async function initOmni() {
  loadPinnedIds()
  document.addEventListener('click', onDocumentClickForMenu)

  window.addEventListener('ccs:phone-offered', handlePhoneOffered)
  window.addEventListener('ccs:phone-ended', handlePhoneEnded)
  window.addEventListener('omni:phone-conversation', handlePhoneConversation as EventListener)
  window.addEventListener('omni:conversation-lifecycle-changed', onConversationStatusChanged as EventListener)
  window.addEventListener('omni:rest-request', onRestRequestNavigate as EventListener)
  agentIm.wireEvents()
  await agentIm.refresh()

  // 首页快速入口 ?panel=history|kb|tickets
  const panel = String(route.query.panel || '')
  if (panel === 'history') listTab.value = 'history'
  if (panel === 'kb') sideTab.value = 'kb'
  if (panel === 'tickets') sideTab.value = 'after'
  if (panel === 'internal') listTab.value = 'internal'

  await loadContacts()
  void openAssignedConversation(route.query.conv)
  void loadAgentStats()
  setInterval(() => { loadAgentStats().catch(() => {}) }, 30000)

  // 页面晚于 Offered 挂载时：从 store 补弹屏/列表（CustomEvent 不会重放）
  const agentStore = useAgentStore()
  if (agentStore.currentCall && agentStore.callPhase !== 'idle') {
    handlePhoneOffered(
      new CustomEvent('ccs:phone-offered', { detail: agentStore.currentCall }) as Event,
    )
  }
  watch(
    () => agentStore.callPhase,
    (phase) => {
      if (phase === 'talking' || phase === 'held') {
        markPhoneSessionConnected(agentStore.currentCall?.CallID)
      }
    },
  )

  // Auto-refresh contacts every 10 seconds (fallback if Socket.io fails)
  setInterval(() => { loadContacts().catch(() => {}) }, 10000)

  // Listen for Socket.io conversation created events
  window.addEventListener('omni:conversation-created', () => {
    loadContacts()
  })

  window.addEventListener('omni:unread-changed', onUnreadChanged as EventListener)
  window.addEventListener('omni:conversation-status-changed', onConversationStatusChanged as EventListener)

  watch(
    () => route.query.conv,
    (v) => { void openAssignedConversation(v) },
  )

  // Watch for new socket messages and refresh thread if they match active conversation
  watch(() => socketMessages.value, (newMsgs) => {
    if (newMsgs && newMsgs.length > 0 && activeId.value) {
      const lastMsg = newMsgs[newMsgs.length - 1]
      const activeConvId = parseInt(activeId.value.replace('c', ''), 10)
      if (lastMsg.conversation_id === activeConvId) {
        loadThread(activeId.value)
        void markContactAsRead(activeId.value)
      }
    }
  }, { deep: true })
}

function onUnreadChanged(e: Event) {
  applyUnreadChanged((e as CustomEvent).detail)
}

function onConversationStatusChanged() {
  void loadContacts()
}

onMounted(initOmni)
onUnmounted(() => {
  if (queuePollTimer) clearInterval(queuePollTimer)
  revokeCallAudio()
  stopSessionTimer()
  document.removeEventListener('click', onDocumentClickForMenu)
  window.removeEventListener('omni:unread-changed', onUnreadChanged as EventListener)
  window.removeEventListener('omni:conversation-status-changed', onConversationStatusChanged as EventListener)
  window.removeEventListener('ccs:phone-offered', handlePhoneOffered)
  window.removeEventListener('ccs:phone-ended', handlePhoneEnded)
  window.removeEventListener('omni:phone-conversation', handlePhoneConversation as EventListener)
  window.removeEventListener('omni:conversation-lifecycle-changed', onConversationStatusChanged as EventListener)
  window.removeEventListener('omni:rest-request', onRestRequestNavigate as EventListener)
  // 勿 disconnectSocket：话务 Socket 属全局会话，离开本页不能拆 CCS 连接
})
</script>

<style scoped>
.omni {
  display: grid;
  gap: 0;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--oa-card);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #d8e4f0;
  /* 单行网格：禁止按内容撑高把底栏顶出可视区 */
  grid-template-rows: minmax(0, 1fr);
  align-content: stretch;
}

.omni-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: #f8fafc;
}

.omni-list-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.omni-list-head {
  display: flex;
  gap: 8px;
  padding: 10px;
  flex-shrink: 0;
}
.omni-stat-chip {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #d8e4f0;
  line-height: 1.2;
}
.omni-stat-label {
  color: var(--el-button-text-color, #606266);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.omni-stat-chip strong {
  font-weight: 600;
  font-size: 12px;
  color: #1f2d3d;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.omni-stat-chip .sep {
  margin: 0 4px;
  color: #c0c8d4;
  font-weight: 400;
}
.omni-stat-chip em {
  font-style: normal;
}
.omni-stat-chip em.ok {
  color: #2f9b63;
}
.omni-stat-chip em.miss {
  color: #d9892b;
}
.call-kind-ico,
.call-conn-ico {
  display: inline-flex;
  align-items: center;
  margin-right: 2px;
  font-size: 13px;
  vertical-align: middle;
}
.call-kind-ico {
  color: #409eff;
}
.call-conn-ico.is-ok {
  color: #67c23a;
}
.call-conn-ico.is-miss {
  color: #f56c6c;
}

.omni-tabs {
  flex-shrink: 0;
}
.omni-tabs :deep(.el-tabs__header) {
  margin: 0 10px;
}
/* 只用 tabs 作切换头，内容区为空但会占高，必须隐藏 */
.omni-tabs :deep(.el-tabs__content) {
  display: none;
}
.omni-search {
  margin: 0 10px 8px;
  flex-shrink: 0;
}
.omni-history-tools {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 10px 8px;
  flex-shrink: 0;
}

.omni-internal-bar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #ebeef5;
  align-items: center;
}
.omni-internal-input {
  flex: 1;
}
.omni-internal-composer-wrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #fff;
}
.omni-rest-bar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: #fdf6ec;
  border-top: 1px solid #f5dab1;
  align-items: center;
}
.rest-approve-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rest-approve-hint {
  margin: 0;
  font-size: 13px;
  color: #909399;
  line-height: 1.4;
}
.rest-approve-label {
  display: block;
  font-size: 14px;
  color: #606266;
  margin-bottom: 6px;
}
.rest-approve-duration-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rest-approve-unit {
  font-size: 13px;
  color: #606266;
}
.omni-internal-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.omni-internal-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #e6a23c;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  font-style: normal;
}
.omni-internal-badge.is-msg {
  background: #f56c6c;
}

.omni-scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 8px;
}

.omni-row {
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 3px;
  position: relative;
}
.omni-row.pinned {
  border-left: 3px solid #409eff;
  padding-left: 4px;
}
.omni-row:hover {
  background: #e8f1fa;
}
.omni-row.active {
  background: #d4e8f7;
}

.omni-row-main {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  position: relative;
  padding-right: 30px;
}
.omni-peer {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.25;
}
.omni-peer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.omni-peer-title {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.pin-mark {
  flex-shrink: 0;
  color: #409eff;
  display: inline-flex;
  align-items: center;
}
.pin-mark .el-icon {
  font-size: 12px;
}
.flag-mark {
  flex-shrink: 0;
  color: #e6a23c;
  display: inline-flex;
  align-items: center;
}
.flag-mark .el-icon {
  font-size: 12px;
}
.omni-name {
  font-weight: 600;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.omni-life-tag {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 16px;
  padding: 0 5px;
  border-radius: 3px;
  color: #b88230;
  background: #fff7e6;
}
.omni-life-tag.ended {
  color: #909399;
  background: #f4f4f5;
}
.omni-life-tag.queued {
  color: #1d4ed8;
  background: #dbeafe;
}
/* ── 会话列表头像：按来源渠道着色（原先是 el-avatar 默认灰，分不出渠道）── */
/* 兜底：任何未识别的渠道也用彩色，绝不留 el-avatar 的默认灰 */
.omni-row-main .el-avatar {
  background: #0284c7;
  color: #fff;
}
/*
 * 渠道色板：按色相环均匀分布，相邻相隔 ≥20°。
 * 之前多个渠道挤在同一色系（企微/网站/API 三个蓝、小程序/社媒两个紫、邮件/电话两个橙），
 * 在 17px 的小图标上根本分不出来，这里刻意把色相拉开。
 * 色相：微博0 邮件22 电话48 微信100 短信168 网站202 API232 企微264 小程序292 社媒328
 */
.omni-row-main .el-avatar.av-weibo {
  background: #dc2626; /* 0° 正红 */
}
.omni-row-main .el-avatar.av-email {
  background: #ea580c; /* 22° 橙 */
}
.omni-row-main .el-avatar.av-phone {
  background: #4d7c0f; /* 48° 琥珀 */
}
.omni-row-main .el-avatar.av-wechat {
  background: #16a34a; /* 100° 绿 */
}
.omni-row-main .el-avatar.av-sms {
  background: #0d9488; /* 168° 青绿 */
}
.omni-row-main .el-avatar.av-web {
  background: #0284c7; /* 202° 天蓝 */
}
.omni-row-main .el-avatar.av-api {
  background: #1a3be6; /* 232° 靛蓝 */
}
.omni-row-main .el-avatar.av-wecom {
  background: #7c3aed; /* 264° 紫 */
}
.omni-row-main .el-avatar.av-miniprogram {
  background: #c026d3; /* 292° 品红 */
}
.omni-row-main .el-avatar.av-social {
  background: #db2777; /* 328° 玫红 */
}

.ch-icons-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  /* 每个渠道图标自带品牌色，这里不再统一着色（原先全灰，分不清渠道） */
}
.ch-icons-inline .el-icon {
  font-size: 12px;
  width: 17px;
  height: 17px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
/* 与头像同一套色板，按色相环均匀分布，相邻相隔 ≥20° */
.ch-icons-inline .ch-weibo {
  background: #dc2626; /* 0° 正红 */
}
.ch-icons-inline .ch-email {
  background: #ea580c; /* 22° 橙 */
}
.ch-icons-inline .ch-phone {
  background: #4d7c0f; /* 48° 琥珀 */
}
.ch-icons-inline .ch-wechat {
  background: #16a34a; /* 100° 绿 */
}
.ch-icons-inline .ch-sms {
  background: #0d9488; /* 168° 青绿 */
}
.ch-icons-inline .ch-web {
  background: #0284c7; /* 202° 天蓝 */
}
.ch-icons-inline .ch-api {
  background: #1a3be6; /* 232° 靛蓝 */
}
.ch-icons-inline .ch-wecom {
  background: #7c3aed; /* 264° 紫 */
}
.ch-icons-inline .ch-miniprogram {
  background: #c026d3; /* 292° 品红 */
}
.ch-icons-inline .ch-social {
  background: #db2777; /* 328° 玫红 */
}
.omni-peer-actions {
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.omni-time {
  margin-top: 2px;
  font-size: 11px;
  line-height: 16px;
  color: var(--oa-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.omni-done-btn {
  display: none;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  width: 27px;
  height: 27px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #67c23a;
  cursor: pointer;
  flex-shrink: 0;
  z-index: 1;
}
.omni-done-btn:hover {
  background: #e8f5e9;
}
.omni-done-btn .el-icon {
  font-size: 20px;
}
.omni-row:hover .omni-time {
  visibility: visible;
}
.omni-row:hover .omni-done-btn {
  display: inline-flex;
}
.preview {
  color: var(--oa-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
  line-height: 1.2;
}
.unread {
  margin-left: 4px;
  vertical-align: text-top;
  flex-shrink: 0;
}

.session-ctx-menu {
  position: fixed;
  z-index: 3000;
  min-width: 180px;
  padding: 4px 0;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
.session-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  font-size: 14px;
  color: #303133;
  cursor: pointer;
  text-align: left;
}
.session-ctx-item:hover {
  background: #f5f7fa;
}
.session-ctx-item .el-icon {
  font-size: 16px;
  color: #606266;
}
.session-ctx-divider {
  height: 1px;
  margin: 4px 0;
  background: #ebeef5;
}

.omni-footer {
  display: flex;
  justify-content: space-around;
  gap: 8px;
  padding: 8px;
  border-top: 1px solid #e4e7ed;
  background: #fff;
  flex: 0 0 auto;
  position: relative;
  z-index: 2;
}
.sum-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 20px;
  color: var(--oa-primary);
  background: transparent;
  cursor: pointer;
}
.sum-item:hover {
  background: #f5f7fa;
}
.sum-item.active {
  border-color: var(--oa-primary);
  background: #ecf5ff;
}
.sum-label {
  font-size: 12px;
  line-height: 1;
}

.omni-chat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.omni-history-readonly,
.omni-ended-banner {
  padding: 12px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--oa-muted);
  background: #f5f7fa;
  border-top: 1px solid #e4e7ed;
}
.omni-ended-banner {
  border-bottom: 1px solid #e4e7ed;
}
.omni-queue-banner {
  padding: 8px 16px;
  text-align: center;
  font-size: 13px;
  color: #1d4ed8;
  background: #eff6ff;
  border-top: 1px solid #bfdbfe;
  border-bottom: 1px solid #bfdbfe;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.omni-chat-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
  min-width: 0;
}
.omni-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
}
.omni-head-phone-toolbar {
  flex: 1;
  min-width: 0;
}
.omni-head-phone-toolbar :deep(.phone-call-toolbar) {
  border-bottom: none;
  background: transparent;
  padding: 0;
  justify-content: flex-end;
}
.peer-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.omni-session-duration {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
  padding: 0 4px;
}
.omni-session-duration em {
  font-style: normal;
  font-family: ui-monospace, monospace;
  color: var(--oa-primary);
  font-weight: 600;
}
.omni-session-duration-label {
  color: #606266;
}
.tag {
  margin: 0;
}
.meta {
  font-size: 12px;
  color: var(--oa-muted);
  margin-top: 6px;
}
.omni-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.omni-call-video { flex: 0 0 auto; min-width: 0; border-bottom: 1px solid #dce6f0; }
.omni-call-video :deep(.video-stage) { height: clamp(180px, 34vh, 340px); min-height: 180px; aspect-ratio: auto; }
@media (max-width: 600px) {
  .omni-call-video :deep(.video-stage) { height: clamp(160px, 28vh, 240px); min-height: 160px; }
}

.omni-thread {
  flex: 1;
  padding: 16px;
  background: #f0f4f8;
  overflow-y: auto;
  min-height: 0;
}

.live-captions {
  flex-shrink: 0;
  max-height: 160px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #dbe4ee;
  background: #fff;
}
.live-captions-hd {
  padding: 6px 12px 0;
  font-size: 12px;
  color: var(--oa-muted);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.live-captions--collapsed {
  max-height: none;
  padding: 4px 12px 6px;
}
.live-captions-toggle {
  border: 0;
  background: transparent;
  color: #3b82f6;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  font-weight: 500;
}
.live-captions-toggle:hover {
  text-decoration: underline;
}
.live-captions-list {
  overflow-y: auto;
  padding: 6px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.live-caption {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.45;
}
.live-caption-role {
  flex-shrink: 0;
  min-width: 32px;
  font-size: 12px;
  font-weight: 600;
}
.live-caption.customer .live-caption-role {
  color: #3b82f6;
}
.live-caption.agent .live-caption-role {
  color: #059669;
}
.live-caption-text {
  color: #334155;
  word-break: break-word;
}
.live-captions-empty {
  font-size: 12px;
  color: var(--oa-muted);
}

.thread-day {
  margin-bottom: 16px;
}
.day-label {
  text-align: center;
  font-size: 12px;
  color: var(--oa-muted);
  margin-bottom: 12px;
}

.omni-input {
  border-top: 1px solid #ebeef5;
  background: #fff;
  display: flex;
  flex-direction: column;
  position: relative;
  min-height: 160px;
}
.input-resize-handle {
  height: 4px;
  cursor: ns-resize;
  flex-shrink: 0;
  background: transparent;
  transition: background 0.15s;
}
.input-resize-handle:hover {
  background: var(--el-color-primary, #409eff);
}
.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 6px 0;
  flex-shrink: 0;
}
.input-toolbar-left {
  display: flex;
  align-items: center;
}
.tool-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  color: #606266;
}
.tool-btn:hover {
  color: var(--el-color-primary, #409eff);
}
.tool-btn-dropdown {
  width: auto;
  min-width: 40px;
  padding: 0 4px;
}
.tool-caret {
  font-size: 10px;
  margin-left: 1px;
  vertical-align: middle;
}
.tool-btn-history {
  margin-left: auto;
}
.chat-input {
  flex: 1;
  min-height: 0;
  padding: 0 10px;
}
.chat-input :deep(.el-textarea__inner) {
  height: 100% !important;
  min-height: 72px;
  line-height: 1.5;
  border: none;
  box-shadow: none;
  padding: 6px 4px;
  background: #fff;
  font-size: 14px;
  resize: none;
}
.chat-input :deep(.el-textarea__inner:focus) {
  box-shadow: none;
}
.input-footer-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 10px;
  flex-shrink: 0;
}
.btn-close {
  border-radius: 18px;
  padding: 8px 22px;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #303133;
}
.btn-close:hover {
  color: var(--el-color-primary, #409eff);
  border-color: #c6e2ff;
  background: #ecf5ff;
}
.input-footer-actions :deep(.el-dropdown .el-button-group .el-button) {
  border-radius: 0;
}
.input-footer-actions :deep(.el-dropdown .el-button-group > .el-button:first-child) {
  border-radius: 18px 0 0 18px;
  padding: 8px 18px;
}
.input-footer-actions :deep(.el-dropdown .el-button-group > .el-button:last-child) {
  border-radius: 0 18px 18px 0;
  padding: 8px 10px;
}
.quick-reply-bar {
  padding: 0 12px 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.qr-tag {
  cursor: pointer;
  user-select: none;
}
.qr-tag:hover {
  background: #409eff;
  color: #fff;
}

/* 独立网格列作分隔条，不挡会话区滚动条、不被 overflow 裁切 */
.omni-resize-track {
  cursor: ew-resize;
  touch-action: none;
  background: #edf1f6;
  border-left: 1px solid #e4e7ed;
  border-right: 1px solid #e4e7ed;
  box-sizing: border-box;
  min-height: 0;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.omni-resize-track:hover,
.omni-resize-track.is-dragging {
  background: rgba(64, 158, 255, 0.18);
  box-shadow: inset 0 0 0 1px rgba(64, 158, 255, 0.35);
}

.omni-side {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fafafa;
}

.side-tabs-bar {
  display: flex;
  align-items: flex-end;
  flex-shrink: 0;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
}
.side-tabs-main {
  flex: 1;
  min-width: 0;
  width: 0;
}
.side-tabs-main :deep(.el-tabs__header) {
  margin-bottom: 0;
  width: 100%;
}
/* 勿覆盖 nav-wrap overflow：需保留 EP 内置的左右箭头 + translate 滚动 */
.side-tabs-main :deep(.el-tabs__nav-wrap.is-scrollable) {
  padding: 0 22px;
  box-sizing: border-box;
}
.side-tabs-main :deep(.el-tabs__nav-next),
.side-tabs-main :deep(.el-tabs__nav-prev) {
  z-index: 4;
  width: 22px;
  line-height: 40px;
  background: #fafafa;
}
.side-tabs-main :deep(.el-tabs__nav-next) {
  box-shadow: -6px 0 8px -4px rgba(0, 0, 0, 0.08);
}
.side-tabs-main :deep(.el-tabs__nav-prev) {
  box-shadow: 6px 0 8px -4px rgba(0, 0, 0, 0.08);
}
.side-tabs-main :deep(.el-tabs__nav-next:not(.is-disabled):hover),
.side-tabs-main :deep(.el-tabs__nav-prev:not(.is-disabled):hover) {
  color: var(--el-color-primary);
}
.side-all-dropdown {
  flex-shrink: 0;
  align-self: stretch;
  display: flex;
  align-items: flex-end;
  padding: 0 6px 2px 4px;
}
.side-all-trigger {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  font-size: 12px;
  color: #606266;
  padding: 0 8px 10px;
  line-height: 1;
  user-select: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  white-space: nowrap;
}
.side-all-trigger:hover {
  color: #409eff;
}
.side-all-trigger.is-active {
  color: #409eff;
  font-weight: 600;
  border-bottom-color: #409eff;
}
.side-all-arrow {
  font-size: 10px;
}

.side-tabs :deep(.el-tabs__nav-wrap) {
  padding: 0 4px;
}
.side-tabs :deep(.el-tabs__item) {
  padding: 0 8px;
  font-size: 12px;
}

.side-scroll {
  flex: 1;
  padding: 8px 12px 16px;
}
.side-field {
  margin-bottom: 10px;
}
.crm-side-form {
  margin-bottom: 8px;
}
.crm-save-btn {
  width: 100%;
  margin-bottom: 4px;
}
.desc {
  margin-bottom: 12px;
}
.side-sub {
  font-weight: 600;
  margin: 12px 0 8px;
  font-size: 13px;
}

.side-table {
  margin-bottom: 4px;
}
.visits-table :deep(.link-cell) {
  display: inline-block;
  max-width: 100%;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}
.muted {
  font-size: 12px;
  color: var(--oa-muted);
  margin: 4px 0;
}

.consult-scroll {
  padding-bottom: 24px;
}
.consult-form {
  padding-right: 4px;
}
.consult-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.consult-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: #303133;
  line-height: 1.3;
  padding-bottom: 4px;
}
.consult-class-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}
.consult-class-grid :deep(.el-radio) {
  margin: 0;
  height: auto;
  align-items: flex-start;
  padding: 8px 10px;
  width: 100%;
  white-space: normal;
}
.consult-sub-row {
  display: flex;
  gap: 10px;
  width: 100%;
}
.urgency-group {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.urg-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 0;
}
.urg-flag {
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 1px;
  flex-shrink: 0;
}
.urg-high {
  background: #f56c6c;
}
.urg-medium {
  background: #e6a23c;
}
.urg-low {
  background: #67c23a;
}
.template-box {
  width: 100%;
  min-height: 72px;
  background: #f0f2f5;
  border: 1px dashed #c0c8d4;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.template-add {
  border-style: dashed;
}
.consult-actions {
  display: flex;
  gap: 12px;
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px solid #ebeef5;
}

.after-scroll {
  padding-bottom: 16px;
}
.after-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.after-phone-input {
  flex: 1;
  min-width: 0;
}
.after-table {
  width: 100%;
}
.after-table :deep(.el-table__header th) {
  background: #f2f4f7;
  font-weight: 600;
}

.ecom-scroll {
  padding-bottom: 16px;
}
.ecom-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 14px;
}
.ecom-search-input {
  flex: 1;
  min-width: 0;
}
.ecom-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ecom-card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 12px 14px 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.ecom-card-head {
  margin-bottom: 12px;
}
.ecom-badge {
  display: inline-block;
  padding: 2px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(180deg, #f5a742 0%, #e8890e 100%);
  border-radius: 3px;
}
.ecom-section {
  font-size: 12px;
}
.ecom-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
@media (max-width: 1100px) {
  .ecom-grid-2 {
    grid-template-columns: 1fr;
  }
}
.ecom-field {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  line-height: 1.45;
}
.ecom-k {
  flex: 0 0 auto;
  color: #909399;
  min-width: 4.5em;
}
.ecom-v {
  color: #303133;
  word-break: break-all;
}
.ecom-money {
  font-weight: 600;
  color: #c45656;
}
.ecom-dotted-line {
  margin: 12px 0;
  border: none;
  border-top: 1px dotted #dcdfe6;
}
.ecom-logistics-block {
  font-size: 12px;
}
.ecom-tracking {
  margin-bottom: 10px;
}
.ecom-tracking-no {
  margin-left: 8px;
  font-weight: 600;
}
.ecom-tl-heading {
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}
.ecom-timeline {
  list-style: none;
  padding: 0 0 0 4px;
  margin: 0;
}
.ecom-tl-item {
  position: relative;
  padding-left: 18px;
  padding-bottom: 14px;
}
.ecom-tl-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 10px;
  bottom: -4px;
  width: 2px;
  background: #dcdfe6;
}
.ecom-tl-dot {
  position: absolute;
  left: 0;
  top: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c4cc;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px #dcdfe6;
  z-index: 1;
}
.ecom-tl-item.is-active .ecom-tl-dot {
  background: #409eff;
  box-shadow: 0 0 0 1px #409eff;
}
.ecom-tl-meta {
  color: #606266;
  margin-bottom: 4px;
}
.ecom-tl-loc {
  color: #409eff;
}
.ecom-tl-text {
  color: #303133;
  line-height: 1.5;
}

.call-scroll {
  padding-bottom: 12px;
}
.call-ops {
  display: flex;
  flex-wrap: nowrap;
  gap: 0;
  align-items: center;
  justify-content: flex-start;
}
.call-op-wrap {
  display: inline-flex;
}
.call-ops :deep(.el-button) {
  padding: 0 4px;
  margin: 0;
  min-width: 24px;
}
.call-ops :deep(.el-icon) {
  font-size: 15px;
}
.call-player {
  padding: 4px 0 8px;
}
.call-player-label {
  font-size: 12px;
  color: var(--oa-muted);
  margin-bottom: 6px;
}
.call-audio {
  width: 100%;
}
.call-player-actions,
.call-refresh {
  margin-top: 8px;
}
.call-audio-error {
  margin: 8px 0 0;
  color: #f56c6c;
  font-size: 12px;
}
.session-event-timeline {
  padding-left: 4px;
  margin-top: 4px;
}
.session-event-timeline :deep(.el-timeline-item__content) {
  font-size: 12px;
  color: #303133;
}
.session-event-timeline :deep(.el-timeline-item__timestamp) {
  font-size: 11px;
}

.kb-scroll {
  padding-bottom: 12px;
}
.kb-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.kb-search-input {
  flex: 1;
  min-width: 0;
}
.kb-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  margin-bottom: 14px;
}
.kb-chip {
  border: 1px solid #dcdfe6;
  background: #f4f6f9;
  color: #606266;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 16px;
  cursor: pointer;
  line-height: 1.3;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.kb-chip:hover {
  border-color: #c6e2ff;
  color: #409eff;
}
.kb-chip.is-active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
  font-weight: 600;
}
.kb-list {
  min-height: 120px;
}
.kb-item {
  padding: 12px 10px;
  border-bottom: 1px dotted #dcdfe6;
  cursor: pointer;
  transition: background 0.15s;
}
.kb-item:last-child {
  border-bottom: none;
}
.kb-item:hover {
  background: #f5f7fa;
}
.kb-item.is-active {
  background: #eceff3;
}
.kb-item-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}
.kb-item-title {
  font-size: 13px;
  font-weight: 700;
  color: #303133;
  line-height: 1.4;
}
.kb-item-time {
  flex-shrink: 0;
  font-size: 12px;
  color: #909399;
}
.kb-item-summary {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.55;
}
</style>
