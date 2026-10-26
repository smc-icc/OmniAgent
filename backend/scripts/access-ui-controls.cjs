// One-time migration of existing actionable Vue controls to the shared permission directive.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('../frontend/src');
const rules = {
  'views/OmnichannelService.vue': { exportHistory: 'conversation.export', markConversationDone: 'conversation.close', endActiveSession: 'conversation.close', leaveQueue: 'conversation.close', saveCrmSideProfile: 'customer.update', playOnAgent: 'conversation.recording', playLocal: 'conversation.recording', downloadRecording: 'conversation.recording', submitMediaTransfer: 'conversation.transfer', claimLeave: 'voicemail.claim', onApproveRest: 'schedule.approve', submitRestApprove: 'schedule.approve' },
  'components/chat/ChatComposer.vue': { sendMessage: 'conversation.reply', send: 'conversation.reply', handleSend: 'conversation.reply', sendShake: 'conversation.reply', disableAutoReply: 'conversation.ai', smsDialogVisible: 'sms.send', emailDialogVisible: 'email.send' },
};
for (const [file, mapping] of Object.entries(rules)) {
  const full = path.join(root, file);
  const src = fs.readFileSync(full, 'utf8');
  const updated = src.replace(/<(el-button|button)\b[^>]*>/g, tag => {
    if (tag.includes('v-permission')) return tag;
    const handler = /@click(?:\.[\w]+)*="([^"]+)"/.exec(tag)?.[1];
    const name = handler && /^\w+/.exec(handler)?.[0];
    if (!mapping[name]) return tag;
    return tag.replace(/^<([\w-]+)/, `<$1 v-permission="'${mapping[name]}'"`);
  });
  fs.writeFileSync(full, updated);
}
