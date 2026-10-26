<template>
  <div class="cp">
    <!-- 列表 -->
    <template v-if="!detailTaskId">
      <div class="cp-list-hd">
        <div class="cp-list-filters">
          <el-select v-model="listCampusId" style="width: 260px" placeholder="请选择校区">
            <el-option v-for="c in meta?.campuses ?? []" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-button type="primary" @click="loadTaskList">查询</el-button>
        </div>
        <div class="cp-list-actions">
          <el-button type="primary" @click="openCreate">创建分班任务</el-button>
          <el-button type="primary" :disabled="listSelection.length !== 1" @click="openModify">修改分班任务</el-button>
          <el-button :disabled="listSelection.length === 0" @click="onDeleteTasks">删除分班任务</el-button>
        </div>
      </div>

      <el-table
        v-loading="listLoading"
        :data="listRows"
        border
        size="small"
        class="cp-mt"
        @selection-change="(r: ClassPlacementTaskRow[]) => (listSelection = r)"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="name" label="分班任务名称" min-width="140" />
        <el-table-column prop="semester" label="学期" min-width="200" />
        <el-table-column prop="campus_name" label="校区" min-width="180" />
        <el-table-column prop="grade" label="年级" width="100" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <span :class="row.status_code === 'not_applied' ? 'cp-status-warn' : 'cp-status-ok'">{{
              row.status_label
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="enterDetail(row.id)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="cp-pager">
        <el-pagination
          v-model:current-page="listPage"
          v-model:page-size="listPageSize"
          :total="listTotal"
          layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 20, 50]"
          @current-change="loadTaskList"
          @size-change="loadTaskList"
        />
      </div>
    </template>

    <!-- 分班向导 -->
    <template v-else>
      <div class="cp-detail-hd">
        <div class="cp-crumb">
          <el-button link type="primary" @click="backToList">学生分班</el-button>
          <span class="cp-crumb-div">/</span>
          <span>学生列表</span>
        </div>
        <div v-if="detail && viewStep === 4 && detail.placement_done" class="cp-detail-actions">
          <el-button type="primary" @click="onApply">应用分班结果</el-button>
          <el-button type="primary" @click="openNotifyDialog">通知家长分班结果</el-button>
        </div>
      </div>

      <!-- 自绘步骤条：圆点与标题整块可点（el-steps 的数字圆不在 #title 内，点圆不触发） -->
      <div v-if="detail" class="cp-stepbar" role="tablist" aria-label="分班步骤">
        <button
          type="button"
          class="cp-stepbar-item"
          :class="{ 'cp-stepbar-item--active': viewStep === 1, 'cp-stepbar-item--done': viewStep > 1 }"
          @click="goStep(1)"
        >
          <span class="cp-stepbar-num">1</span>
          <span class="cp-stepbar-txt">确认学生信息</span>
        </button>
        <span class="cp-stepbar-line" aria-hidden="true" />
        <button
          type="button"
          class="cp-stepbar-item"
          :class="{ 'cp-stepbar-item--active': viewStep === 2, 'cp-stepbar-item--done': viewStep > 2 }"
          @click="goStep(2)"
        >
          <span class="cp-stepbar-num">2</span>
          <span class="cp-stepbar-txt">确认规则</span>
        </button>
        <span class="cp-stepbar-line" aria-hidden="true" />
        <button
          type="button"
          class="cp-stepbar-item"
          :class="{ 'cp-stepbar-item--active': viewStep === 3, 'cp-stepbar-item--done': viewStep > 3 }"
          @click="goStep(3)"
        >
          <span class="cp-stepbar-num">3</span>
          <span class="cp-stepbar-txt">自动分班</span>
        </button>
        <span class="cp-stepbar-line" aria-hidden="true" />
        <button
          type="button"
          class="cp-stepbar-item"
          :class="{ 'cp-stepbar-item--active': viewStep === 4 }"
          @click="goStep(4)"
        >
          <span class="cp-stepbar-num">4</span>
          <span class="cp-stepbar-txt">查看结果</span>
        </button>
      </div>

      <div v-loading="detailLoading" class="cp-detail-body">
        <!-- 步骤 1 -->
        <template v-if="detail && viewStep === 1">
          <el-tabs v-model="innerTab" class="cp-tabs">
            <el-tab-pane label="行政班" name="admin">
              <div class="cp-toolbar">
                <el-button type="primary" @click="startPlacementModalVisible = true">开始分班</el-button>
                <div class="cp-toolbar-right">
                  <el-button @click="drawerNewClass = true">新建班级</el-button>
                  <el-button disabled>导入班级名单</el-button>
                  <el-button disabled>修改班名</el-button>
                  <el-button disabled>添加均分</el-button>
                  <el-button disabled type="danger" plain>删除班级</el-button>
                </div>
              </div>
              <el-empty
                v-if="(detail.admin_classes?.length ?? 0) === 0"
                description="可导入学生名单，或直接点击「开始分班」自动生成"
              >
                <el-button type="primary" @click="startPlacementModalVisible = true">开始分班</el-button>
              </el-empty>
              <el-table v-else :data="detail.admin_classes" border size="small" class="cp-mt">
                <el-table-column prop="name" label="班级名称" />
                <el-table-column prop="student_count" label="人数" width="100" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="学生列表" name="student">
              <div class="cp-toolbar cp-toolbar-wrap">
                <el-select v-model="fGroup" placeholder="班级组" clearable style="width: 120px" @change="loadStudents">
                  <el-option v-for="x in filterOpt?.class_groups ?? []" :key="x.id" :label="x.label" :value="x.id" />
                </el-select>
                <el-select
                  v-model="fClassId"
                  placeholder="选择班级"
                  clearable
                  style="width: 140px"
                  @change="loadStudents"
                >
                  <el-option v-for="x in filterOpt?.classes ?? []" :key="x.id" :label="x.label" :value="x.id" />
                </el-select>
                <el-select v-model="fGender" placeholder="选择性别" clearable style="width: 100px" @change="loadStudents">
                  <el-option v-for="x in filterOpt?.genders ?? []" :key="x.id" :label="x.label" :value="x.id" />
                </el-select>
                <el-select v-model="fTag" placeholder="学生标签" clearable style="width: 100px" @change="loadStudents">
                  <el-option v-for="x in filterOpt?.tags ?? []" :key="x.id" :label="x.label" :value="x.id" />
                </el-select>
                <el-select
                  v-model="fSchool"
                  placeholder="毕业学校"
                  clearable
                  style="width: 120px"
                  @change="loadStudents"
                >
                  <el-option v-for="x in filterOpt?.schools ?? []" :key="x.id" :label="x.label" :value="x.id" />
                </el-select>
                <el-input
                  v-model="fQ"
                  placeholder="请输入学生姓名或学号"
                  clearable
                  style="width: 200px"
                  @keyup.enter="loadStudents"
                />
                <el-button type="primary" @click="loadStudents">查询</el-button>
                <div class="cp-toolbar-right">
                  <el-button type="primary" :disabled="stuSel.length === 0" @click="openMoveDrawer">移动至新班级</el-button>
                  <el-button type="primary" @click="drawerScore = true">添加总分</el-button>
                </div>
              </div>
              <el-table :data="stuRows" border size="small" class="cp-mt" @selection-change="onStuSelectionChange">
                <el-table-column type="selection" width="48" />
                <el-table-column prop="class_name" label="班级" width="120" />
                <el-table-column prop="student_name" label="姓名" width="100" />
                <el-table-column prop="student_no" label="学号" width="120" />
                <el-table-column prop="gender" label="性别" width="72" />
                <el-table-column prop="tag" label="学生标签" width="100" />
                <el-table-column prop="school" label="毕业学校" min-width="120" />
              </el-table>
              <div class="cp-pager">
                <el-pagination
                  v-model:current-page="stuPage"
                  v-model:page-size="stuPageSize"
                  :total="stuTotal"
                  layout="total, sizes, prev, pager, next, jumper"
                  :page-sizes="[10, 20, 50]"
                  @current-change="loadStudents"
                  @size-change="loadStudents"
                />
              </div>
            </el-tab-pane>
          </el-tabs>
          <div class="cp-footer-next">
            <el-button type="primary" @click="goStep(2)">进入确认规则</el-button>
          </div>
        </template>

        <!-- 步骤 2 -->
        <template v-else-if="detail && viewStep === 2">
          <div class="cp-rules-card">
            <div class="cp-rules-hd">
              <span class="cp-bar" />
              <span>确认规则</span>
            </div>
            <div class="cp-rules-row">
              <el-tag type="primary" effect="plain">{{ detail.group_mode }}</el-tag>
              <span class="cp-muted">设置班级个数:</span>
              <el-input-number v-model="ruleClassCount" :min="1" :max="20" />
              <el-popover placement="bottom" :width="280" trigger="click">
                <template #reference>
                  <el-button type="primary" plain>设置规则</el-button>
                </template>
                <div class="cp-rule-presets">
                  <el-button
                    v-for="p in rulePresets"
                    :key="p"
                    size="small"
                    class="cp-preset-btn"
                    @click="addRulePreset(p)"
                  >
                    {{ p }}
                  </el-button>
                </div>
              </el-popover>
            </div>
            <ul class="cp-rule-list">
              <li
                v-for="(r, idx) in editableRules"
                :key="r.id"
                class="cp-rule-item"
                draggable="true"
                @dragstart="onRuleDragStart(idx)"
                @dragover.prevent
                @drop="onRuleDrop(idx)"
              >
                <span class="cp-drag">⠿</span>
                <span>{{ r.label }}</span>
                <el-button link type="danger" class="cp-rule-del" @click="removeRule(idx)">
                  <el-icon><Close /></el-icon>
                </el-button>
              </li>
            </ul>
          </div>
          <div class="cp-footer-next">
            <el-button type="primary" :loading="savingRules" @click="saveRulesAndNext">保存并下一步</el-button>
          </div>
        </template>

        <!-- 步骤 3 -->
        <template v-else-if="detail && viewStep === 3">
          <el-tabs v-model="innerTab" class="cp-tabs">
            <el-tab-pane label="行政班" name="admin">
              <div class="cp-toolbar">
                <el-button type="primary" @click="startPlacementModalVisible = true">开始分班</el-button>
                <div class="cp-toolbar-right">
                  <el-button disabled>导入班级名单</el-button>
                  <el-button @click="drawerNewClass = true">新建班级</el-button>
                  <el-button disabled>修改班名</el-button>
                  <el-button disabled>添加均分</el-button>
                  <el-button disabled>删除班级</el-button>
                </div>
              </div>
              <el-empty description="可导入学生名单，或直接点击「开始分班」自动分班">
                <el-button type="primary" @click="startPlacementModalVisible = true">开始分班</el-button>
              </el-empty>
            </el-tab-pane>
            <el-tab-pane label="学生列表" name="student">
              <div class="cp-muted cp-pad-sm">与第一步学生列表相同，可切换上方「行政班」后点击开始分班。</div>
            </el-tab-pane>
          </el-tabs>
        </template>

        <!-- 步骤 4 -->
        <template v-else-if="detail && viewStep === 4">
          <el-tabs v-model="step4Tab" class="cp-tabs">
            <el-tab-pane label="结果评估" name="eval">
              <div class="cp-toolbar">
                <el-tag type="info" effect="plain">{{ detail.evaluation?.grouping_tab ?? '不分组' }}</el-tag>
                <div class="cp-toolbar-right">
                  <el-button @click="recalcEval">重新计算结果评估</el-button>
                  <el-icon class="cp-help-icon" title="按当前分班结果重算均衡度"><QuestionFilled /></el-icon>
                </div>
              </div>
              <el-table
                v-if="detail.evaluation"
                :data="detail.evaluation.rows"
                border
                size="small"
                class="cp-mt"
                scrollbar-always-on
              >
                <el-table-column prop="rule" label="分班规则" width="160" fixed />
                <el-table-column
                  v-for="(lab, i) in detail.evaluation.class_labels"
                  :key="i"
                  :label="lab"
                  min-width="88"
                >
                  <template #default="{ row }">
                    {{ row.cells[i] ?? '—' }}
                  </template>
                </el-table-column>
                <el-table-column label="检查结果" width="120" fixed="right">
                  <template #default="{ row }">
                    {{ row.check_result }}
                  </template>
                </el-table-column>
              </el-table>
              <div v-else class="cp-eval-empty">
                <p class="cp-eval-empty-txt">
                  第 4 步上方的列表是<strong>结果评估表</strong>：按分班规则统计各班人数、男女比例、标签分布等，用于确认均衡度后再「应用分班结果」。
                </p>
                <p class="cp-eval-empty-hint">
                  当前任务尚未执行自动分班，暂无数据。请到<strong>第 3 步</strong>点击「开始分班」生成评估表。
                </p>
                <el-button type="primary" @click="goStep(3)">前往第 3 步 · 自动分班</el-button>
              </div>
            </el-tab-pane>
            <el-tab-pane label="分班列表" name="list">
              <div class="cp-toolbar">
                <el-button @click="postClassPlacementExport(detailTaskId).then((r) => ElMessage.success(r.message))">
                  导出分班结果
                </el-button>
                <div class="cp-toolbar-right">
                  <el-button type="primary" @click="drawerNewClass = true">新建班级</el-button>
                  <el-button disabled>修改班名</el-button>
                  <el-button disabled>添加均分</el-button>
                  <el-button disabled>删除班级</el-button>
                </div>
              </div>
              <el-table :data="detail.result_classes" border size="small" class="cp-mt">
                <el-table-column type="selection" width="48" />
                <el-table-column label="班级名称" min-width="120">
                  <template #default="{ row }">
                    <el-button link type="primary">{{ row.display_name }}</el-button>
                  </template>
                </el-table-column>
                <el-table-column prop="student_count" label="人数" width="80" />
                <el-table-column label="男女比例" width="100">
                  <template #default="{ row }">{{ row.ratio_label }}</template>
                </el-table-column>
                <el-table-column prop="group_name" label="班级组" width="100" />
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>
    </template>

    <!-- 创建 / 修改任务 -->
    <el-dialog v-model="createVisible" title="创建分班任务" width="420px" @closed="resetCreateForm">
      <el-form label-width="100px">
        <el-form-item label="任务名称" required>
          <el-input v-model="createForm.name" placeholder="请输入任务名称" maxlength="40" />
        </el-form-item>
        <el-form-item label="学期" required>
          <el-select v-model="createForm.term_id" style="width: 100%">
            <el-option v-for="t in meta?.terms ?? []" :key="t.id" :label="t.label" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="年级" required>
          <el-select v-model="createForm.grade" style="width: 100%">
            <el-option v-for="g in meta?.grades ?? []" :key="g.id" :label="g.label" :value="g.label" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="modifyVisible" title="修改分班任务" width="420px">
      <el-form label-width="100px">
        <el-form-item label="任务名称" required>
          <el-input v-model="modifyForm.name" maxlength="40" />
        </el-form-item>
        <el-form-item label="年级" required>
          <el-input v-model="modifyForm.grade" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="modifyVisible = false">取消</el-button>
        <el-button type="primary" @click="submitModify">保存</el-button>
      </template>
    </el-dialog>

    <!-- 开始分班 -->
    <el-dialog v-model="startPlacementModalVisible" title="开始分班提示" width="400px">
      <p>确认现在开始分班吗？</p>
      <template #footer>
        <el-button @click="startPlacementModalVisible = false">取消</el-button>
        <el-button type="primary" :loading="startingPl" @click="confirmStartPlacement">开始</el-button>
      </template>
    </el-dialog>

    <!-- 通知家长 -->
    <el-dialog v-model="notifyVisible" title="通知家长分班结果" width="640px" destroy-on-close>
      <el-alert type="warning" :closable="false" show-icon class="cp-mb">
        下列 {{ notifyCheck?.total_missing ?? 0 }} 名学生未查询到家长账号，将无法收到通知，请在学生管理或家校通讯录中自查完善。
      </el-alert>
      <el-table :data="notifyCheck?.items ?? []" border size="small" max-height="280">
        <el-table-column prop="index" label="序号" width="60" />
        <el-table-column prop="class_name" label="班级" width="120" />
        <el-table-column prop="student_name" label="学生姓名" width="120" />
        <el-table-column prop="student_no" label="学号" />
      </el-table>
      <template #footer>
        <el-button @click="notifyVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmNotify">确定</el-button>
      </template>
    </el-dialog>

    <!-- 新建班级 -->
    <el-drawer v-model="drawerNewClass" title="新建班级" size="400px">
      <el-form label-width="100px">
        <el-form-item label="班级名称" required>
          <el-input v-model="newClassName" maxlength="8" placeholder="请输入八个字以内班级名称" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerNewClass = false">取消</el-button>
        <el-button type="primary" @click="submitNewClass">创建</el-button>
      </template>
    </el-drawer>

    <!-- 移动班级 -->
    <el-drawer v-model="drawerMove" title="移动至新班级" size="400px">
      <el-form label-width="120px">
        <el-form-item label="修改人数">
          <span>{{ stuSel.length }} 人</span>
        </el-form-item>
        <el-form-item label="新班级" required>
          <el-select v-model="moveTargetClassId" placeholder="请选择班级" style="width: 100%">
            <el-option v-for="x in moveClassOptions" :key="x.id" :label="x.label" :value="x.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="drawerMove = false">取消</el-button>
        <el-button type="primary" @click="submitMove">完成</el-button>
      </template>
    </el-drawer>

    <!-- 添加科目总分 -->
    <el-drawer v-model="drawerScore" title="添加科目总分" size="420px">
      <div class="cp-score-sect">请选择科目</div>
      <el-checkbox v-model="subjAll" :indeterminate="subjInd" @change="toggleSubjAll">全选</el-checkbox>
      <div class="cp-subj-grid">
        <el-checkbox-group v-model="subjPick">
          <el-checkbox v-for="s in subjects" :key="s.id" :value="s.id">{{ s.label }}</el-checkbox>
        </el-checkbox-group>
      </div>
      <div class="cp-score-sect">请选择类型</div>
      <el-radio-group v-model="subjKind">
        <el-radio label="score">分数</el-radio>
        <el-radio label="rank">排名</el-radio>
      </el-radio-group>
      <div class="cp-score-sect">已选择</div>
      <el-input :model-value="subjSummary" type="textarea" readonly :rows="2" />
      <template #footer>
        <el-button @click="drawerScore = false">取消</el-button>
        <el-button type="primary" @click="submitScore">添加</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { Close, QuestionFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import {
  deleteClassPlacementTasks,
  fetchClassPlacementFilterOptions,
  fetchClassPlacementMeta,
  fetchClassPlacementNotifyCheck,
  fetchClassPlacementSubjects,
  fetchClassPlacementTaskDetail,
  fetchClassPlacementTasks,
  fetchClassPlacementStudents,
  postClassPlacementAdminClass,
  postClassPlacementApply,
  postClassPlacementExport,
  postClassPlacementMoveStudents,
  postClassPlacementNotifyParents,
  postClassPlacementRecalc,
  postClassPlacementRules,
  postClassPlacementStart,
  postClassPlacementStep,
  postClassPlacementSubjectTotal,
  postClassPlacementTask,
  putClassPlacementTask,
  type ClassPlacementDetail,
  type ClassPlacementTaskRow,
} from '@/api/classPlacement'

type PlacementStudentRow = Awaited<ReturnType<typeof fetchClassPlacementStudents>>['items'][number]

const meta = ref<Awaited<ReturnType<typeof fetchClassPlacementMeta>> | null>(null)
const listCampusId = ref('')
const listLoading = ref(false)
const listRows = ref<ClassPlacementTaskRow[]>([])
const listSelection = ref<ClassPlacementTaskRow[]>([])
const listPage = ref(1)
const listPageSize = ref(10)
const listTotal = ref(0)

const detailTaskId = ref('')
const detail = ref<ClassPlacementDetail | null>(null)
const detailLoading = ref(false)
/** 当前展示的步骤（与 el-steps 圆点整块可点同步；接口失败时仍以服务端 detail.step 为准） */
const viewStep = ref(1)

const innerTab = ref<'admin' | 'student'>('admin')
const step4Tab = ref<'eval' | 'list'>('eval')

const filterOpt = ref<Awaited<ReturnType<typeof fetchClassPlacementFilterOptions>> | null>(null)
const fGroup = ref('')
const fClassId = ref('')
const fGender = ref('')
const fTag = ref('')
const fSchool = ref('')
const fQ = ref('')
const stuRows = ref<PlacementStudentRow[]>([])
const stuTotal = ref(0)
const stuPage = ref(1)
const stuPageSize = ref(10)
const stuSel = ref<PlacementStudentRow[]>([])

const ruleClassCount = ref(7)
const editableRules = ref<{ id: string; label: string }[]>([])
const ruleDragIndex = ref<number | null>(null)
const rulePresets = [
  '男女比例均衡',
  '毕业学校均衡',
  '同标签学生均分到各个班-A、B、C、D',
  '学生绑定',
  '成绩均衡（总分）',
  '体能均衡',
]
const savingRules = ref(false)

const createVisible = ref(false)
const createForm = ref({ name: '', term_id: 'term-2526-1', grade: '一年级' })
const modifyVisible = ref(false)
const modifyForm = ref({ name: '', grade: '' })

const startPlacementModalVisible = ref(false)
const startingPl = ref(false)

const notifyVisible = ref(false)
const notifyCheck = ref<Awaited<ReturnType<typeof fetchClassPlacementNotifyCheck>> | null>(null)

const drawerNewClass = ref(false)
const newClassName = ref('')

const drawerMove = ref(false)
const moveTargetClassId = ref('')

const drawerScore = ref(false)
const subjects = ref<{ id: string; label: string }[]>([])
const subjPick = ref<string[]>([])
const subjAll = ref(false)
const subjInd = ref(false)
const subjKind = ref<'score' | 'rank'>('score')

const moveClassOptions = computed(() => {
  const d = detail.value
  if (!d) return []
  const fromRc = (d.result_classes ?? []).map((x) => ({ id: x.id, label: x.display_name }))
  if (fromRc.length) return fromRc
  return (d.admin_classes ?? []).map((x) => ({ id: x.id, label: x.name }))
})

const subjSummary = computed(() => {
  const labels = subjects.value.filter((s) => subjPick.value.includes(s.id)).map((s) => s.label)
  return labels.length ? labels.join('、') : '请选择总分科目'
})

watch(subjPick, (v) => {
  const n = subjects.value.length
  subjAll.value = n > 0 && v.length === n
  subjInd.value = v.length > 0 && v.length < n
})

watch(
  () => detail.value?.step,
  (s) => {
    const n = Number(s)
    if (!Number.isNaN(n) && n >= 1 && n <= 4) {
      viewStep.value = n
    }
  },
)

function toggleSubjAll(val: boolean | string | number) {
  const on = val === true
  subjPick.value = on ? subjects.value.map((s) => s.id) : []
}

async function loadTaskList() {
  if (!listCampusId.value) return
  listLoading.value = true
  try {
    const data = await fetchClassPlacementTasks({
      campus_id: listCampusId.value,
      page: listPage.value,
      page_size: listPageSize.value,
    })
    listRows.value = data.items
    listTotal.value = data.total
  } finally {
    listLoading.value = false
  }
}

async function enterDetail(taskId: string) {
  detailTaskId.value = taskId
  detail.value = null
  viewStep.value = 1
  innerTab.value = 'admin'
  step4Tab.value = 'eval'
  await refreshDetail()
}

async function refreshDetail() {
  if (!detailTaskId.value) return
  detailLoading.value = true
  try {
    const d = await fetchClassPlacementTaskDetail(detailTaskId.value)
    detail.value = d
    ruleClassCount.value = d.class_count
    editableRules.value = d.rules.map((r) => ({ ...r }))
    filterOpt.value = await fetchClassPlacementFilterOptions(detailTaskId.value)
    await loadStudents()
    subjects.value = (await fetchClassPlacementSubjects(detailTaskId.value)).items
  } finally {
    detailLoading.value = false
  }
}

function onStuSelectionChange(r: PlacementStudentRow[]) {
  stuSel.value = r
}

async function loadStudents() {
  if (!detailTaskId.value) return
  const data = await fetchClassPlacementStudents(detailTaskId.value, {
    class_id: fClassId.value,
    gender: fGender.value,
    tag: fTag.value,
    school: fSchool.value,
    group: fGroup.value === 'all' ? '' : fGroup.value,
    q: fQ.value,
    page: stuPage.value,
    page_size: stuPageSize.value,
  })
  stuRows.value = data.items
  stuTotal.value = data.total
}

async function goStep(step: number) {
  if (!detailTaskId.value || !detail.value) return
  if (step < 1 || step > 4) return
  viewStep.value = step
  try {
    await postClassPlacementStep(detailTaskId.value, step)
    await refreshDetail()
  } catch {
    ElMessage.error('切换步骤失败，请检查网络或后端服务')
    await refreshDetail()
  }
}

function backToList() {
  detailTaskId.value = ''
  detail.value = null
  viewStep.value = 1
  loadTaskList()
}

function openCreate() {
  createForm.value = { name: '', term_id: meta.value?.terms[0]?.id ?? 'term-2526-1', grade: '一年级' }
  createVisible.value = true
}

function resetCreateForm() {
  createForm.value = { name: '', term_id: 'term-2526-1', grade: '一年级' }
}

async function submitCreate() {
  if (!createForm.value.name.trim()) {
    ElMessage.warning('请输入任务名称')
    return
  }
  if (!listCampusId.value) {
    ElMessage.warning('请先在列表页选择校区')
    return
  }
  await postClassPlacementTask({
    campus_id: listCampusId.value,
    name: createForm.value.name.trim(),
    term_id: createForm.value.term_id,
    grade: createForm.value.grade,
  })
  ElMessage.success('已创建')
  createVisible.value = false
  await loadTaskList()
}

function openModify() {
  const r = listSelection.value[0]
  if (!r) return
  modifyForm.value = { name: r.name, grade: r.grade }
  modifyVisible.value = true
}

async function submitModify() {
  const r = listSelection.value[0]
  if (!r) return
  await putClassPlacementTask(r.id, { name: modifyForm.value.name, grade: modifyForm.value.grade })
  ElMessage.success('已保存')
  modifyVisible.value = false
  await loadTaskList()
}

async function onDeleteTasks() {
  const ids = listSelection.value.map((x) => x.id)
  if (!ids.length) return
  await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 个任务？`, '提示', { type: 'warning' })
  await deleteClassPlacementTasks(ids)
  ElMessage.success('已删除')
  listSelection.value = []
  await loadTaskList()
}

function onRuleDragStart(idx: number) {
  ruleDragIndex.value = idx
}

function onRuleDrop(idx: number) {
  const from = ruleDragIndex.value
  ruleDragIndex.value = null
  if (from === null || from === idx) return
  const arr = [...editableRules.value]
  const [it] = arr.splice(from, 1)
  arr.splice(idx, 0, it)
  editableRules.value = arr
}

function addRulePreset(label: string) {
  if (editableRules.value.some((r) => r.label === label)) {
    ElMessage.info('该规则已存在')
    return
  }
  editableRules.value.push({ id: `ru-${Date.now()}`, label })
}

function removeRule(idx: number) {
  editableRules.value.splice(idx, 1)
}

async function saveRulesAndNext() {
  if (!detailTaskId.value) return
  savingRules.value = true
  try {
    await postClassPlacementRules(detailTaskId.value, {
      class_count: ruleClassCount.value,
      rules: editableRules.value,
    })
    viewStep.value = 3
    await postClassPlacementStep(detailTaskId.value, 3)
    ElMessage.success('已保存规则')
    await refreshDetail()
  } finally {
    savingRules.value = false
  }
}

async function confirmStartPlacement() {
  if (!detailTaskId.value) return
  startingPl.value = true
  try {
    const r = await postClassPlacementStart(detailTaskId.value)
    ElMessage.success(r.message)
    startPlacementModalVisible.value = false
    viewStep.value = 4
    await refreshDetail()
    step4Tab.value = 'eval'
  } finally {
    startingPl.value = false
  }
}

async function recalcEval() {
  if (!detailTaskId.value) return
  const r = await postClassPlacementRecalc(detailTaskId.value)
  ElMessage.success(r.message)
  await refreshDetail()
}

async function onApply() {
  if (!detailTaskId.value) return
  const r = await postClassPlacementApply(detailTaskId.value)
  ElMessage.success(r.message)
  await refreshDetail()
  await loadTaskList()
}

async function openNotifyDialog() {
  if (!detailTaskId.value) return
  notifyCheck.value = await fetchClassPlacementNotifyCheck(detailTaskId.value)
  notifyVisible.value = true
}

async function confirmNotify() {
  if (!detailTaskId.value) return
  const r = await postClassPlacementNotifyParents(detailTaskId.value)
  ElMessage.success(r.message)
  notifyVisible.value = false
}

async function submitNewClass() {
  const nm = newClassName.value.trim()
  if (!nm || nm.length > 8) {
    ElMessage.warning('请输入不超过8个字的班级名称')
    return
  }
  if (!detailTaskId.value) return
  await postClassPlacementAdminClass(detailTaskId.value, nm)
  ElMessage.success('已创建班级')
  newClassName.value = ''
  drawerNewClass.value = false
  await refreshDetail()
}

function openMoveDrawer() {
  moveTargetClassId.value = ''
  drawerMove.value = true
}

async function submitMove() {
  if (!detailTaskId.value || !moveTargetClassId.value) {
    ElMessage.warning('请选择新班级')
    return
  }
  const ids = stuSel.value.map((s) => s.id)
  const r = await postClassPlacementMoveStudents(detailTaskId.value, ids, moveTargetClassId.value)
  ElMessage.success(r.message)
  drawerMove.value = false
  await refreshDetail()
}

async function submitScore() {
  if (!detailTaskId.value) {
    return
  }
  if (subjPick.value.length === 0) {
    ElMessage.warning('请选择科目')
    return
  }
  await postClassPlacementSubjectTotal(detailTaskId.value, subjPick.value, subjKind.value)
  ElMessage.success('已添加')
  drawerScore.value = false
}

onMounted(async () => {
  meta.value = await fetchClassPlacementMeta()
  listCampusId.value = meta.value.campuses[0]?.id ?? ''
  await loadTaskList()
})
</script>

<style scoped>
.cp {
  padding: 16px 20px 24px;
  min-height: 480px;
}
.cp-list-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.cp-list-filters {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cp-list-actions {
  display: flex;
  gap: 10px;
}
.cp-mt {
  margin-top: 12px;
}
.cp-pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.cp-status-warn {
  color: var(--el-color-warning);
  font-weight: 500;
}
.cp-status-ok {
  color: var(--el-color-success);
}
.cp-detail-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.cp-crumb {
  font-size: 14px;
  color: var(--oa-muted, #606266);
}
.cp-crumb-div {
  margin: 0 6px;
}
.cp-detail-actions {
  display: flex;
  gap: 10px;
}
.cp-stepbar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0;
  margin: 16px 0 20px;
  padding: 12px 8px;
  background: #fafafa;
  border-radius: 4px;
  border: 1px solid #ebeef5;
}
.cp-stepbar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: #909399;
}
.cp-stepbar-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: 4px;
}
.cp-stepbar-num {
  width: 28px;
  height: 28px;
  line-height: 28px;
  text-align: center;
  border-radius: 50%;
  border: 2px solid #c0c4cc;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
}
.cp-stepbar-item--active .cp-stepbar-num {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}
.cp-stepbar-item--done .cp-stepbar-num {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.cp-stepbar-item--active .cp-stepbar-txt {
  color: var(--el-color-primary);
  font-weight: 600;
}
.cp-stepbar-txt {
  font-size: 13px;
  white-space: nowrap;
  max-width: 7.5em;
  text-align: center;
  line-height: 1.3;
}
.cp-stepbar-line {
  flex: 1;
  min-width: 24px;
  max-width: 64px;
  height: 2px;
  background: #dcdfe6;
  margin: 0 2px 24px;
}
.cp-detail-body {
  min-height: 320px;
}
.cp-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.cp-toolbar-wrap {
  margin-bottom: 10px;
}
.cp-toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.cp-footer-next {
  margin-top: 24px;
  text-align: center;
}
.cp-rules-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 16px 18px;
  background: var(--el-fill-color-blank);
}
.cp-rules-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 14px;
}
.cp-bar {
  width: 4px;
  height: 16px;
  background: var(--el-color-primary);
  border-radius: 2px;
}
.cp-rules-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.cp-muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.cp-pad-sm {
  padding: 8px 0;
}
.cp-rule-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cp-rule-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  margin-bottom: 8px;
  background: #fff;
}
.cp-drag {
  cursor: grab;
  color: var(--el-text-color-placeholder);
  user-select: none;
}
.cp-rule-del {
  margin-left: auto;
}
.cp-rule-presets {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-preset-btn {
  margin: 0 !important;
  justify-content: flex-start;
}
.cp-help-icon {
  cursor: help;
  color: var(--el-text-color-secondary);
  font-size: 18px;
}
.cp-eval-empty {
  margin-top: 20px;
  padding: 24px 20px;
  text-align: center;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  border: 1px dashed var(--el-border-color);
}
.cp-eval-empty-txt,
.cp-eval-empty-hint {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--el-text-color-regular);
  max-width: 560px;
  margin-left: auto;
  margin-right: auto;
}
.cp-eval-empty-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 16px;
}
.cp-mb {
  margin-bottom: 12px;
}
.cp-score-sect {
  font-weight: 600;
  margin: 12px 0 8px;
}
.cp-subj-grid {
  margin: 8px 0 12px;
}
</style>
