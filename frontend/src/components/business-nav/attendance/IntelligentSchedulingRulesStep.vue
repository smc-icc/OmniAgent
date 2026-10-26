<template>
  <div class="isr">
    <div class="isr-toolbar">
      <div class="isr-toolbar-spacer" />
      <input
        ref="ruleImportInputRef"
        type="file"
        accept="application/json,.json"
        class="isr-file-input"
        @change="onRuleImportFile"
      />
      <el-button type="primary" size="small" @click="ruleImportInputRef?.click()">规则导入</el-button>
      <el-button size="small" @click="exportRulesJson">规则导出</el-button>
      <el-button type="primary" size="small" @click="ruleListOpen = true">规则列表</el-button>
    </div>

    <el-tabs v-model="rules.main_tab" type="card" class="isr-main-tabs" @tab-change="onMainTabChange">
      <el-tab-pane label="班级限制" name="class_limit">
        <SchedulingRuleGridPanel
          v-model:selected-id="rules.restriction_selection.class_limit"
          v-model:grids="rules.restriction_grids.class_limit"
          v-model:tags="rules.restriction_tags"
          :tree-data="rules.class_limit_tree"
          group-settings-label="班级组设置"
        />
      </el-tab-pane>
      <el-tab-pane label="老师限制" name="teacher_limit">
        <SchedulingRuleGridPanel
          v-model:selected-id="rules.restriction_selection.teacher_limit"
          v-model:grids="rules.restriction_grids.teacher_limit"
          v-model:tags="rules.restriction_tags"
          :tree-data="rules.teacher_limit_tree"
          group-settings-label="老师组设置"
          show-search
          search-placeholder="请输入老师姓名"
        />
      </el-tab-pane>
      <el-tab-pane label="课程限制" name="course_limit">
        <SchedulingRuleGridPanel
          v-model:selected-id="rules.restriction_selection.course_limit"
          v-model:grids="rules.restriction_grids.course_limit"
          v-model:tags="rules.restriction_tags"
          :tree-data="rules.course_limit_tree"
          group-settings-label="课程组设置"
        />
      </el-tab-pane>
      <el-tab-pane label="连堂限制" name="consecutive">
        <el-alert type="info" :closable="false" class="isr-banner" show-icon>
          连堂由课务安排中「任教课时」形态决定（如 4+1）。下表为当前任务下的连堂规则摘要（演示数据可编辑保存）。
        </el-alert>
        <el-table
          v-if="rules.consecutive_rows.length"
          :data="rules.consecutive_rows"
          border
          size="small"
          stripe
          class="isr-consec-table"
        >
          <el-table-column prop="course_name" label="课程" min-width="140" />
          <el-table-column prop="scope" label="范围" width="140" />
          <el-table-column prop="pattern" label="课时形态" width="100" />
          <el-table-column prop="remark" label="说明" min-width="220" />
          <el-table-column label="操作" width="72" fixed="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="removeConsecutiveRow(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else :image-size="120">
          <template #description>
            <p>提示：当前暂未设置连堂课，请在「课务安排 - 任教课时」中设置连堂课程的课时。</p>
            <p class="isr-hint">如：课时设置为「4+1」，即为 4 节单堂、1 节连堂，共 6 课时。</p>
          </template>
        </el-empty>
      </el-tab-pane>
      <el-tab-pane label="课程关联" name="course_link">
        <el-alert type="info" :closable="false" class="isr-banner" show-icon>
          同班级内课程关联：同天互斥、禁止相邻、必排相邻（演示）。
        </el-alert>
        <div class="isr-cols3">
          <div class="isr-panel">
            <div class="isr-panel-title">选择需要添加关联的课程</div>
            <el-scrollbar max-height="320">
              <el-checkbox-group v-model="courseAssocChecked" class="isr-check-list">
                <el-checkbox v-for="c in rules.course_catalog" :key="c" :value="c" class="isr-check-line">
                  {{ c }}
                </el-checkbox>
              </el-checkbox-group>
            </el-scrollbar>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">选择需要添加的关联</div>
            <el-radio-group v-model="rules.course_assoc_type" class="isr-radio-stack">
              <el-radio-button value="same_day_mutex">同天互斥</el-radio-button>
              <el-radio-button value="forbid_adjacent">禁止相邻</el-radio-button>
              <el-radio-button value="must_adjacent">必排相邻</el-radio-button>
            </el-radio-group>
            <p class="isr-muted">同班级如下课程必安排在前后相邻的两节（必排相邻时生效）。</p>
            <div v-if="rules.course_assoc_type === 'must_adjacent'" class="isr-adj-pair">
              <span class="isr-slot">前</span>
              <el-icon><Link /></el-icon>
              <span class="isr-slot">后</span>
            </div>
            <el-button type="primary" class="isr-add-btn" @click="addCourseAssoc">添加关联 &gt;</el-button>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">已添加的课程关联</div>
            <el-empty v-if="!rules.course_assoc_items.length" description="未添加课程关联" :image-size="72" />
            <el-table v-else :data="rules.course_assoc_items" border size="small" max-height="280">
              <el-table-column label="类型" width="100">
                <template #default="{ row }">{{ assocTypeLabel(row.assoc_type) }}</template>
              </el-table-column>
              <el-table-column label="课程" min-width="200">
                <template #default="{ row }">{{ row.courses.join('、') }}</template>
              </el-table-column>
              <el-table-column label="操作" width="72" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeCourseAssoc(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="合班" name="merge_class">
        <el-alert type="info" :closable="false" class="isr-banner" show-icon>合班为系统硬性规则，排课结果须满足。</el-alert>
        <div class="isr-cols4">
          <div class="isr-panel">
            <div class="isr-panel-title">选择合班课程</div>
            <el-scrollbar max-height="260">
              <div
                v-for="c in rules.course_catalog.slice(0, 8)"
                :key="c"
                class="isr-list-line"
                :class="{ 'isr-list-line--on': rules.merge_selected_course === c }"
                @click="rules.merge_selected_course = c"
              >
                {{ c }}
              </div>
            </el-scrollbar>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">选择合班班级</div>
            <el-collapse>
              <el-collapse-item
                v-for="g in rules.merge_grade_classes"
                :key="g.grade"
                :title="g.grade"
                :name="g.grade"
              >
                <el-checkbox-group v-model="mergeClassChecked" class="isr-check-list">
                  <el-checkbox v-for="cl in g.classes" :key="cl.id" :value="cl.id" class="isr-check-line">
                    {{ cl.label }}
                  </el-checkbox>
                </el-checkbox-group>
              </el-collapse-item>
            </el-collapse>
          </div>
          <div class="isr-panel isr-panel-narrow">
            <div class="isr-panel-title">当前选中的班级课程</div>
            <div class="isr-panel-blank isr-preview">
              <template v-if="rules.merge_selected_course">
                <div class="isr-preview-line"><strong>课程</strong> {{ rules.merge_selected_course }}</div>
                <div v-for="lab in mergePreviewLabels" :key="lab" class="isr-preview-line">{{ lab }}</div>
              </template>
            </div>
            <el-button type="primary" size="small" @click="addMergeRule">添加合班 &gt;</el-button>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">已添加的合班课程</div>
            <el-input placeholder="请输入班级或科目" size="small" clearable class="isr-mb" />
            <el-empty v-if="!rules.merge_rules.length" description="未添加合班课" :image-size="64" />
            <el-table v-else :data="rules.merge_rules" border size="small" max-height="240">
              <el-table-column prop="course" label="课程" width="120" />
              <el-table-column label="班级" min-width="200">
                <template #default="{ row }">{{ row.class_labels.join('、') }}</template>
              </el-table-column>
              <el-table-column label="操作" width="72" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeMergeRule(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="同时上课" name="simultaneous">
        <el-alert type="info" :closable="false" class="isr-banner" show-icon>
          同时上课为系统硬性规则，排课结果须满足。
        </el-alert>
        <div class="isr-sim-grid">
          <div class="isr-panel">
            <div class="isr-panel-title">选择同时上课课程</div>
            <el-scrollbar max-height="280">
              <div
                v-for="c in rules.course_catalog"
                :key="c"
                class="isr-list-line"
                :class="{ 'isr-list-line--on': rules.sim_selected_course === c }"
                @click="rules.sim_selected_course = c"
              >
                {{ c }}
              </div>
            </el-scrollbar>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">选择同时上课班级</div>
            <el-collapse>
              <el-collapse-item
                v-for="g in rules.simultaneous_grades"
                :key="g.grade"
                :title="g.grade"
                :name="g.grade"
              >
                <el-checkbox-group v-model="simultaneousChecked" class="isr-check-list">
                  <el-checkbox v-for="cl in g.classes" :key="cl.id" :value="cl.id" class="isr-check-line">
                    {{ cl.label }}
                  </el-checkbox>
                </el-checkbox-group>
              </el-collapse-item>
            </el-collapse>
          </div>
          <div class="isr-panel isr-panel-narrow">
            <div class="isr-panel-title">当前选中的班级课程</div>
            <div class="isr-panel-blank isr-preview">
              <template v-if="rules.sim_selected_course">
                <div class="isr-preview-line"><strong>课程</strong> {{ rules.sim_selected_course }}</div>
                <div v-for="lab in simPreviewLabels" :key="lab" class="isr-preview-line">{{ lab }}</div>
              </template>
            </div>
            <el-button type="primary" size="small" @click="addSimultaneousRule">添加同时上课 &gt;</el-button>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">已添加的同时上课课程</div>
            <el-input placeholder="请输入班级或科目" size="small" clearable class="isr-mb" />
            <el-empty v-if="!rules.simultaneous_rules.length" description="暂无同时上课组" :image-size="64" />
            <el-table v-else :data="rules.simultaneous_rules" border size="small" max-height="240">
              <el-table-column prop="course" label="课程" width="120" />
              <el-table-column label="班级" min-width="200">
                <template #default="{ row }">{{ row.class_labels.join('、') }}</template>
              </el-table-column>
              <el-table-column label="操作" width="72" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeSimRule(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="教师关联" name="teacher_link">
        <div class="isr-cols3">
          <div class="isr-panel">
            <div class="isr-panel-title">选择需要添加关联的老师</div>
            <el-input placeholder="请输入内容" size="small" clearable class="isr-mb" />
            <el-input model-value="语文/校本语文" size="small" class="isr-mb" readonly />
            <el-scrollbar max-height="280">
              <el-checkbox-group v-model="rules.teacher_assoc_selected" class="isr-check-list">
                <el-checkbox
                  v-for="t in rules.teacher_assoc_candidates"
                  :key="t.id"
                  :value="t.id"
                  class="isr-check-line"
                >
                  {{ t.name }}
                </el-checkbox>
              </el-checkbox-group>
            </el-scrollbar>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">选择需要添加的关联</div>
            <el-radio-group v-model="rules.teacher_assoc_mode" class="isr-radio-stack">
              <el-radio-button value="mutual_exclusion">教师互斥</el-radio-button>
              <el-radio-button value="mentor_follow">师徒跟随</el-radio-button>
            </el-radio-group>
            <p class="isr-muted">如下两位老师的课程不会同时安排。</p>
            <div class="isr-chip-box">
              <el-tag v-for="id in rules.teacher_assoc_selected" :key="id" class="isr-tag">
                {{ teacherName(id) }}
              </el-tag>
            </div>
            <el-button type="primary" class="isr-add-btn" @click="addTeacherAssoc">添加不同时开课关联 &gt;</el-button>
          </div>
          <div class="isr-panel">
            <div class="isr-panel-title">已添加的教师关联</div>
            <el-empty v-if="!rules.teacher_assoc_items.length" description="未添加教师关联" :image-size="72" />
            <el-table v-else :data="rules.teacher_assoc_items" border size="small" max-height="280">
              <el-table-column label="模式" width="100">
                <template #default="{ row }">{{ teacherAssocModeLabel(row.mode) }}</template>
              </el-table-column>
              <el-table-column label="教师" min-width="160">
                <template #default="{ row }">{{ row.teacher_names.join('、') }}</template>
              </el-table-column>
              <el-table-column label="操作" width="72" fixed="right">
                <template #default="{ row }">
                  <el-button link type="danger" size="small" @click="removeTeacherAssoc(row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="更多规则" name="more_rules">
        <el-tabs v-model="rules.more_rules_subtab" class="isr-subtabs" @tab-change="onMoreSubtabChange">
          <el-tab-pane label="时段限制" name="time_slot">
            <el-alert type="info" :closable="false" class="isr-banner" show-icon>
              此为优化规则，系统将尽量满足；可在课表结果中查看满足情况评估。
            </el-alert>
            <div class="isr-cols3">
              <div class="isr-panel">
                <div class="isr-panel-title">选择需要添加限制的老师</div>
                <el-tree
                  ref="timeTreeRef"
                  :data="rules.teacher_tree_time_limit"
                  show-checkbox
                  node-key="id"
                  default-expand-all
                  :props="{ label: 'label', children: 'children' }"
                  @check="onTimeTreeCheck"
                />
              </div>
              <div class="isr-panel">
                <div class="isr-panel-title">选择需要添加的限制</div>
                <el-radio-group v-model="slotLimitKind" class="isr-radio-stack">
                  <el-radio-button value="session">午别限制</el-radio-button>
                  <el-radio-button value="period">节次限制</el-radio-button>
                </el-radio-group>
                <p class="isr-muted">可限制老师在一周内对应午别/节次的排课总次数。</p>
                <div class="isr-form-block">
                  <div class="isr-label">选择时段</div>
                  <el-radio-group v-model="rules.time_slot_form.day_part">
                    <el-radio value="morning">上午</el-radio>
                    <el-radio value="afternoon">下午</el-radio>
                  </el-radio-group>
                </div>
                <div class="isr-form-block">
                  <div class="isr-label">选择限制</div>
                  <el-radio-group v-model="rules.time_slot_form.limit_kind">
                    <el-radio value="max">最多排</el-radio>
                    <el-radio value="fixed">固定排</el-radio>
                  </el-radio-group>
                  <el-input-number v-model="rules.time_slot_form.limit_value" :min="0" :max="20" size="small" />
                </div>
                <el-button type="primary" class="isr-add-btn" @click="addTimeSlotRule">添加关联 &gt;</el-button>
              </div>
              <div class="isr-panel">
                <div class="isr-panel-title">已添加的时段限制</div>
                <el-empty v-if="!rules.time_slot_rules.length" description="未添加时段限制" :image-size="72" />
                <el-table v-else :data="rules.time_slot_rules" border size="small" max-height="280">
                  <el-table-column label="范围" width="88">
                    <template #default="{ row }">{{ row.slot_kind === 'period' ? '节次' : '午别' }}</template>
                  </el-table-column>
                  <el-table-column label="教师" min-width="120">
                    <template #default="{ row }">{{ row.teacher_labels.join('、') }}</template>
                  </el-table-column>
                  <el-table-column label="时段" width="72">
                    <template #default="{ row }">{{ row.day_part === 'afternoon' ? '下午' : '上午' }}</template>
                  </el-table-column>
                  <el-table-column label="限制" min-width="120">
                    <template #default="{ row }">
                      {{ row.limit_kind === 'fixed' ? '固定排' : '最多排' }} {{ row.limit_value }}
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="72" fixed="right">
                    <template #default="{ row }">
                      <el-button link type="danger" size="small" @click="removeTimeSlotRule(row.id)">删除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="日任课" name="daily">
            <el-alert type="info" :closable="false" class="isr-banner" show-icon>
              此为优化规则，系统将尽量满足。
            </el-alert>
            <div class="isr-daily-wrap">
              <div class="isr-course-side">
                <div class="isr-panel-title">选择日任课课程</div>
                <div
                  class="isr-course-item"
                  :class="{ 'isr-course-item--on': rules.daily_course_selected === '__all__' }"
                  @click="rules.daily_course_selected = '__all__'"
                >
                  全部课程
                </div>
                <div
                  v-for="c in rules.course_catalog"
                  :key="c"
                  class="isr-course-item"
                  :class="{ 'isr-course-item--on': rules.daily_course_selected === c }"
                  @click="rules.daily_course_selected = c"
                >
                  {{ c }}
                </div>
              </div>
              <div class="isr-table-side">
                <el-table :data="filteredDailyRows" border size="small" stripe>
                  <el-table-column prop="teacher_name" label="教师姓名" width="100" />
                  <el-table-column prop="course_name" label="课程" min-width="140" />
                  <el-table-column label="2节课时是否允许跨上下午" min-width="220">
                    <template #default="{ row }">
                      <el-button-group>
                        <el-button
                          size="small"
                          :type="row.allow_span_am_pm ? 'primary' : 'default'"
                          @click="row.allow_span_am_pm = true"
                        >
                          允许
                        </el-button>
                        <el-button
                          size="small"
                          :type="!row.allow_span_am_pm ? 'primary' : 'default'"
                          @click="row.allow_span_am_pm = false"
                        >
                          不允许
                        </el-button>
                      </el-button-group>
                    </template>
                  </el-table-column>
                  <el-table-column label="最长连上节数" min-width="200">
                    <template #default="{ row }">
                      <el-button-group>
                        <el-button
                          size="small"
                          :type="row.max_consecutive === null ? 'primary' : 'default'"
                          @click="row.max_consecutive = null"
                        >
                          不限
                        </el-button>
                        <el-button
                          size="small"
                          :type="row.max_consecutive === 3 ? 'primary' : 'default'"
                          @click="row.max_consecutive = 3"
                        >
                          3
                        </el-button>
                        <el-button
                          size="small"
                          :type="row.max_consecutive === 4 ? 'primary' : 'default'"
                          @click="row.max_consecutive = 4"
                        >
                          4
                        </el-button>
                      </el-button-group>
                      <span class="isr-unit">节</span>
                    </template>
                  </el-table-column>
                </el-table>
                <div class="isr-batch">
                  <el-button size="small">批量处理</el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="周任课" name="weekly">
            <el-alert type="info" :closable="false" class="isr-banner" show-icon>
              此为优化规则，系统将尽量满足。
            </el-alert>
            <div class="isr-daily-wrap">
              <div class="isr-course-side">
                <div class="isr-panel-title">选择同任课课程</div>
                <div
                  class="isr-course-item"
                  :class="{ 'isr-course-item--on': rules.weekly_course_selected === '__all__' }"
                  @click="rules.weekly_course_selected = '__all__'"
                >
                  全部课程
                </div>
                <div
                  v-for="c in rules.course_catalog"
                  :key="'w-' + c"
                  class="isr-course-item"
                  :class="{ 'isr-course-item--on': rules.weekly_course_selected === c }"
                  @click="rules.weekly_course_selected = c"
                >
                  {{ c }}
                </div>
              </div>
              <div class="isr-table-side">
                <el-table :data="filteredWeeklyRows" border size="small" stripe>
                  <el-table-column prop="teacher_name" label="教师姓名" width="100" />
                  <el-table-column prop="course_name" label="课程" min-width="130" />
                  <el-table-column label="周任课分布" align="center">
                    <el-table-column label="集中" width="72">
                      <template #default="{ row }">
                        <el-button
                          size="small"
                          :type="row.distribution === 'concentrated' ? 'primary' : 'default'"
                          @click="row.distribution = 'concentrated'"
                        >
                          集
                        </el-button>
                      </template>
                    </el-table-column>
                    <el-table-column label="分散" width="72">
                      <template #default="{ row }">
                        <el-button
                          size="small"
                          :type="row.distribution === 'dispersed' ? 'primary' : 'default'"
                          @click="row.distribution = 'dispersed'"
                        >
                          散
                        </el-button>
                      </template>
                    </el-table-column>
                  </el-table-column>
                  <el-table-column label="教案齐平" align="center">
                    <el-table-column label="周平齐" width="78">
                      <template #default="{ row }">
                        <el-button
                          size="small"
                          :type="row.sync_level === 'weekly' ? 'primary' : 'default'"
                          @click="row.sync_level = 'weekly'"
                        >
                          周
                        </el-button>
                      </template>
                    </el-table-column>
                    <el-table-column label="天平齐" width="78">
                      <template #default="{ row }">
                        <el-button
                          size="small"
                          :type="row.sync_level === 'daily' ? 'primary' : 'default'"
                          @click="row.sync_level = 'daily'"
                        >
                          天
                        </el-button>
                      </template>
                    </el-table-column>
                    <el-table-column label="无需齐平" width="88">
                      <template #default="{ row }">
                        <el-button
                          size="small"
                          :type="row.sync_level === 'none' ? 'primary' : 'default'"
                          @click="row.sync_level = 'none'"
                        >
                          无
                        </el-button>
                      </template>
                    </el-table-column>
                  </el-table-column>
                </el-table>
                <div class="isr-batch">
                  <el-button size="small">批量处理</el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="ruleListOpen" title="规则列表" width="min(920px, 96vw)" destroy-on-close class="isr-dlg">
      <el-tabs v-model="rules.rule_list_modal_tab" type="border-card">
        <el-tab-pane label="全部规则" name="all">
          <el-button type="danger" plain size="small" class="isr-mb">删除规则</el-button>
          <div class="isr-rl-section">
            <div class="isr-rl-hd">
              <span>班级不排课</span>
              <el-button link type="primary">去修改</el-button>
            </div>
            <el-table :data="rules.rule_list_class_no_schedule" border size="small">
              <el-table-column prop="grade_name" label="班级（组）名" width="120" />
              <el-table-column prop="blocked_text" label="不排课节次" min-width="400" />
            </el-table>
          </div>
          <div class="isr-rl-section">
            <div class="isr-rl-hd">
              <span>教师不排课</span>
              <el-button link type="primary">去修改</el-button>
            </div>
            <el-empty description="暂无数据" :image-size="56" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="班级限制" name="class_limit">
          <el-button type="danger" plain size="small" class="isr-mb">删除规则</el-button>
          <el-table :data="rules.rule_list_class_no_schedule" border size="small">
            <el-table-column prop="grade_name" label="班级（组）名" width="120" />
            <el-table-column prop="blocked_text" label="不排课节次" min-width="400" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="教师限制" name="teacher_limit">
          <el-empty description="演示：暂无教师限制规则" />
        </el-tab-pane>
        <el-tab-pane label="课程限制" name="course_limit">
          <el-empty description="演示：暂无课程限制规则" />
        </el-tab-pane>
        <el-tab-pane label="连堂限制" name="consecutive">
          <el-empty description="演示：暂无连堂限制规则（请在课务安排中配置连堂课时）" />
        </el-tab-pane>
        <el-tab-pane label="课程关联" name="course_link">
          <el-table v-if="rules.course_assoc_items.length" :data="rules.course_assoc_items" border size="small">
            <el-table-column label="类型" width="100">
              <template #default="{ row }">{{ assocTypeLabel(row.assoc_type) }}</template>
            </el-table-column>
            <el-table-column label="课程" min-width="280">
              <template #default="{ row }">{{ row.courses.join('、') }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="演示：暂无课程关联规则" />
        </el-tab-pane>
        <el-tab-pane label="合班" name="merge_class">
          <el-table v-if="rules.merge_rules.length" :data="rules.merge_rules" border size="small">
            <el-table-column prop="course" label="课程" width="140" />
            <el-table-column label="班级" min-width="360">
              <template #default="{ row }">{{ row.class_labels.join('、') }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="演示：暂无合班规则" />
        </el-tab-pane>
        <el-tab-pane label="同时上课" name="simultaneous">
          <el-table v-if="rules.simultaneous_rules.length" :data="rules.simultaneous_rules" border size="small">
            <el-table-column prop="course" label="课程" width="140" />
            <el-table-column label="班级" min-width="360">
              <template #default="{ row }">{{ row.class_labels.join('、') }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="演示：暂无同时上课规则" />
        </el-tab-pane>
        <el-tab-pane label="教师关联" name="teacher_link">
          <el-table v-if="rules.teacher_assoc_items.length" :data="rules.teacher_assoc_items" border size="small">
            <el-table-column label="模式" width="120">
              <template #default="{ row }">{{ teacherAssocModeLabel(row.mode) }}</template>
            </el-table-column>
            <el-table-column label="教师" min-width="240">
              <template #default="{ row }">{{ row.teacher_names.join('、') }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="演示：暂无教师关联规则" />
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { Link } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { ElTree } from 'element-plus'
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  mergeSchedulingRules,
  type SchedulingRulesState,
  type SchedulingTreeNode,
} from '@/api/schedulingRulesDefaults'
import SchedulingRuleGridPanel from './SchedulingRuleGridPanel.vue'

const rules = defineModel<SchedulingRulesState>({ required: true })

const ruleListOpen = ref(false)
const ruleImportInputRef = ref<HTMLInputElement | null>(null)
const timeTreeRef = ref<InstanceType<typeof ElTree>>()
const courseAssocChecked = ref<string[]>([])
const mergeClassChecked = ref<string[]>([])
const simultaneousChecked = ref<string[]>([])
/** 午别/节次切换仅为 UI 演示，不改变已保存结构 */
const slotLimitKind = ref<'session' | 'period'>('session')

const filteredDailyRows = computed(() => {
  const sel = rules.value.daily_course_selected
  if (sel === '__all__') return rules.value.daily_rows
  return rules.value.daily_rows.filter((r) => r.course_name === sel)
})

const filteredWeeklyRows = computed(() => {
  const sel = rules.value.weekly_course_selected
  if (sel === '__all__') return rules.value.weekly_rows
  return rules.value.weekly_rows.filter((r) => r.course_name === sel)
})

const mergePreviewLabels = computed(() =>
  mergeClassChecked.value.map((id) => classLabelById(id, rules.value.merge_grade_classes)),
)

const simPreviewLabels = computed(() =>
  simultaneousChecked.value.map((id) => classLabelById(id, rules.value.simultaneous_grades)),
)

function genRuleId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function classLabelById(
  id: string,
  grades: { grade: string; classes: { id: string; label: string }[] }[],
) {
  for (const g of grades) {
    const c = g.classes.find((x) => x.id === id)
    if (c) return c.label
  }
  return id
}

function flatTeacherLeaves(nodes: SchedulingTreeNode[]): Map<string, string> {
  const m = new Map<string, string>()
  function walk(n: SchedulingTreeNode) {
    if (n.children?.length) {
      n.children.forEach(walk)
    } else {
      m.set(n.id, n.label)
    }
  }
  nodes.forEach(walk)
  return m
}

function filterLeafTeacherIds(checked: string[], tree: SchedulingTreeNode[]) {
  const leaves = new Set(flatTeacherLeaves(tree).keys())
  return checked.filter((id) => leaves.has(id))
}

function assocTypeLabel(t: string) {
  const map: Record<string, string> = {
    same_day_mutex: '同天互斥',
    forbid_adjacent: '禁止相邻',
    must_adjacent: '必排相邻',
  }
  return map[t] ?? t
}

function teacherAssocModeLabel(m: string) {
  return m === 'mentor_follow' ? '师徒跟随' : '教师互斥'
}

function teacherName(id: string) {
  return rules.value.teacher_assoc_candidates.find((t) => t.id === id)?.name ?? id
}

function addCourseAssoc() {
  const picked = [...courseAssocChecked.value]
  const typ = rules.value.course_assoc_type
  if (typ === 'must_adjacent') {
    if (picked.length < 2) {
      ElMessage.warning('「必排相邻」请至少勾选 2 门课程')
      return
    }
    rules.value.course_assoc_items.push({
      id: genRuleId(),
      assoc_type: typ,
      courses: picked.slice(0, 2),
    })
  } else {
    if (picked.length < 2) {
      ElMessage.warning('请至少勾选 2 门课程')
      return
    }
    rules.value.course_assoc_items.push({
      id: genRuleId(),
      assoc_type: typ,
      courses: [...picked],
    })
  }
  courseAssocChecked.value = []
  ElMessage.success('已添加课程关联')
}

function removeCourseAssoc(id: string) {
  rules.value.course_assoc_items = rules.value.course_assoc_items.filter((x) => x.id !== id)
}

function addMergeRule() {
  const course = rules.value.merge_selected_course
  const ids = [...mergeClassChecked.value]
  if (!course || !ids.length) {
    ElMessage.warning('请选择合班课程并勾选至少一个班级')
    return
  }
  const labels = ids.map((id) => classLabelById(id, rules.value.merge_grade_classes))
  rules.value.merge_rules.push({
    id: genRuleId(),
    course,
    class_ids: ids,
    class_labels: labels,
  })
  mergeClassChecked.value = []
  ElMessage.success('已添加合班规则')
}

function removeMergeRule(id: string) {
  rules.value.merge_rules = rules.value.merge_rules.filter((x) => x.id !== id)
}

function addSimultaneousRule() {
  const course = rules.value.sim_selected_course
  const ids = [...simultaneousChecked.value]
  if (!course || !ids.length) {
    ElMessage.warning('请选择同时上课课程并勾选至少一个班级')
    return
  }
  const labels = ids.map((id) => classLabelById(id, rules.value.simultaneous_grades))
  rules.value.simultaneous_rules.push({
    id: genRuleId(),
    course,
    class_ids: ids,
    class_labels: labels,
  })
  simultaneousChecked.value = []
  ElMessage.success('已添加同时上课组')
}

function removeSimRule(id: string) {
  rules.value.simultaneous_rules = rules.value.simultaneous_rules.filter((x) => x.id !== id)
}

function addTeacherAssoc() {
  const ids = [...rules.value.teacher_assoc_selected]
  if (ids.length < 2) {
    ElMessage.warning('请至少勾选 2 位教师（演示为成对规则）')
    return
  }
  const pair = ids.slice(0, 2)
  const names = pair.map(teacherName)
  rules.value.teacher_assoc_items.push({
    id: genRuleId(),
    mode: rules.value.teacher_assoc_mode,
    teacher_ids: pair,
    teacher_names: names,
  })
  rules.value.teacher_assoc_selected = []
  ElMessage.success('已添加教师关联')
}

function removeTeacherAssoc(id: string) {
  rules.value.teacher_assoc_items = rules.value.teacher_assoc_items.filter((x) => x.id !== id)
}

function onTimeTreeCheck(_: unknown, info: { checkedKeys: (string | number)[] }) {
  rules.value.time_slot_teacher_checked = info.checkedKeys.map(String)
}

function addTimeSlotRule() {
  const raw = [...rules.value.time_slot_teacher_checked]
  const leafIds = filterLeafTeacherIds(raw, rules.value.teacher_tree_time_limit)
  if (!leafIds.length) {
    ElMessage.warning('请在左侧树中勾选至少一位教师')
    return
  }
  const labelMap = flatTeacherLeaves(rules.value.teacher_tree_time_limit)
  const labels = leafIds.map((id) => labelMap.get(id) ?? id)
  rules.value.time_slot_rules.push({
    id: genRuleId(),
    slot_kind: slotLimitKind.value,
    teacher_ids: leafIds,
    teacher_labels: labels,
    day_part: rules.value.time_slot_form.day_part,
    limit_kind: rules.value.time_slot_form.limit_kind,
    limit_value: rules.value.time_slot_form.limit_value,
  })
  ElMessage.success('已添加时段限制')
}

function removeTimeSlotRule(id: string) {
  rules.value.time_slot_rules = rules.value.time_slot_rules.filter((x) => x.id !== id)
}

function removeConsecutiveRow(id: string) {
  rules.value.consecutive_rows = rules.value.consecutive_rows.filter((x) => x.id !== id)
}

async function onRuleImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid')
    rules.value = mergeSchedulingRules(parsed)
    await nextTick()
    timeTreeRef.value?.setCheckedKeys([...rules.value.time_slot_teacher_checked])
    ElMessage.success('规则已导入并与默认值合并')
  } catch {
    ElMessage.error('导入失败：请使用本页「规则导出」的 JSON 或完整排课规则对象')
  }
}

function exportRulesJson() {
  const blob = new Blob([JSON.stringify(rules.value, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'scheduling-rules.json'
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已导出 scheduling-rules.json')
}

function onMainTabChange() {
  if (rules.value.main_tab === 'more_rules' && rules.value.more_rules_subtab === 'time_slot') {
    nextTick(() => {
      timeTreeRef.value?.setCheckedKeys([...rules.value.time_slot_teacher_checked])
    })
  }
}

function onMoreSubtabChange(name: string | number) {
  if (name === 'time_slot') {
    nextTick(() => {
      timeTreeRef.value?.setCheckedKeys([...rules.value.time_slot_teacher_checked])
    })
  }
}

onMounted(() => {
  nextTick(() => {
    timeTreeRef.value?.setCheckedKeys([...rules.value.time_slot_teacher_checked])
  })
})
</script>

<style scoped>
.isr {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.isr-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.isr-toolbar-spacer {
  flex: 1;
}
.isr-file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.isr-main-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.isr-main-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-top: 10px;
}
.isr-main-tabs :deep(.el-tabs__header) {
  margin: 0;
}
.isr-banner {
  margin-bottom: 12px;
}
.isr-consec-table {
  margin-top: 12px;
}
.isr-hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-top: 8px;
}
.isr-cols3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  align-items: start;
}
.isr-cols4 {
  display: grid;
  grid-template-columns: 1fr 1fr 160px 1fr;
  gap: 12px;
  align-items: start;
}
.isr-sim-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 160px 1fr;
  gap: 12px;
  align-items: start;
}
.isr-panel {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 10px;
  background: #fff;
  min-height: 120px;
}
.isr-panel-narrow {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.isr-panel-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 10px;
  color: var(--el-text-color-primary);
}
.isr-panel-blank {
  flex: 1;
  min-height: 100px;
  background: #fafafa;
  border-radius: 4px;
}
.isr-preview {
  padding: 8px 10px;
  font-size: 13px;
  overflow: auto;
}
.isr-preview-line {
  margin-bottom: 6px;
  color: var(--el-text-color-regular);
}
.isr-check-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.isr-check-line {
  margin: 0;
  display: flex;
  align-items: flex-start;
  white-space: normal;
  height: auto;
}
.isr-radio-stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-bottom: 10px;
}
.isr-radio-stack :deep(.el-radio-button) {
  margin: 0;
}
.isr-muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin: 0 0 10px;
}
.isr-adj-pair {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.isr-slot {
  flex: 1;
  text-align: center;
  padding: 16px 8px;
  border: 1px dashed var(--el-border-color);
  border-radius: 4px;
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}
.isr-add-btn {
  width: 100%;
  margin-top: 8px;
}
.isr-list-line {
  padding: 8px 10px;
  font-size: 13px;
  border-radius: 4px;
  cursor: default;
}
.isr-list-line--on {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}
.isr-mb {
  margin-bottom: 8px;
}
.isr-subtabs {
  min-height: 360px;
}
.isr-form-block {
  margin-bottom: 12px;
}
.isr-label {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
}
.isr-chip-box {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 40px;
  margin-bottom: 10px;
}
.isr-tag {
  margin: 0;
}
.isr-daily-wrap {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.isr-course-side {
  width: 200px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 10px;
  background: #fafafa;
  max-height: 480px;
  overflow: auto;
}
.isr-course-item {
  padding: 8px 10px;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 4px;
}
.isr-course-item:hover {
  background: #eef5ff;
}
.isr-course-item--on {
  background: var(--el-color-primary);
  color: #fff;
}
.isr-table-side {
  flex: 1;
  min-width: 0;
}
.isr-batch {
  margin-top: 10px;
  text-align: right;
}
.isr-unit {
  margin-left: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.isr-rl-section {
  margin-bottom: 20px;
}
.isr-rl-hd {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
}
@media (max-width: 1200px) {
  .isr-cols3,
  .isr-cols4,
  .isr-sim-grid {
    grid-template-columns: 1fr;
  }
  .isr-daily-wrap {
    flex-direction: column;
  }
  .isr-course-side {
    width: 100%;
    max-height: 200px;
  }
}
</style>
