import { strict as assert } from 'node:assert'
import { decideCcsHealthAction, shouldKickMissingCcsSession } from '../src/utils/ccs-health.ts'

assert.equal(shouldKickMissingCcsSession(true, false, false), true, '工作台曾签入且服务端没签入 → 踢')
assert.equal(shouldKickMissingCcsSession(true, true, false), false, '登录页不踢')
assert.equal(shouldKickMissingCcsSession(false, false, false), false, '从未签入 / 主动签出不踢')
assert.equal(shouldKickMissingCcsSession(true, false, true), false, '仍签入不踢')
assert.equal(shouldKickMissingCcsSession(true, false, undefined), false, '未知不踢（避免闪断误下线）')

assert.equal(decideCcsHealthAction(false, { gen: 1, boot: 'a' }, { up: false, generation: 2 }), 'keep')
assert.equal(decideCcsHealthAction(true, { gen: 1, boot: 'a' }, { up: true, generation: 1, logged_in: false }), 'kick')
assert.equal(decideCcsHealthAction(true, { gen: 1, boot: 'a' }, { up: false, generation: 1 }), 'kick')
assert.equal(decideCcsHealthAction(true, { gen: 1, boot: 'a' }, { up: true, generation: 2 }), 'kick')
assert.equal(decideCcsHealthAction(true, { gen: 1, boot: 'a' }, { up: true, generation: 1, bootId: 'b' }), 'kick')
assert.equal(decideCcsHealthAction(true, { gen: 1, boot: 'a' }, { up: true, generation: 1, bootId: 'a' }), 'keep')
assert.equal(decideCcsHealthAction(true, { gen: null, boot: '' }, { up: true, generation: 0 }), 'baseline')

console.log('ccs-health-guard ok')
