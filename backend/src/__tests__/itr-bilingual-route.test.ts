import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({conv:{id:77,inbox_id:5,contact_id:8,additional_attributes:{locale:'en-US',department:'studio'},inbox:{channel_type:'Channel::WebWidget'}},start:vi.fn(),update:vi.fn(),hosted:vi.fn(),vdn:vi.fn()}));
vi.mock('../plugins/db.js',()=>({prisma:{conversations:{findUnique:async()=>m.conv,update:m.update}}}));
vi.mock('../config/env.js',()=>({env:{OMNI_AGENT_VDN_ID:1}}));
vi.mock('../shared/services/conf-tenancy.js',()=>({vdnForConversation:m.vdn}));
vi.mock('../modules/access/access.scope.js',()=>({activeVdn:(v:number)=>v}));
vi.mock('../integrations/ccs/acd-client.js',()=>({acdRing:vi.fn()}));
vi.mock('../shared/services/omni-ops.js',()=>({getQueueTip:vi.fn()}));
vi.mock('../modules/itr/itr-queue.js',()=>({assignConversation:vi.fn(),forgetQueue:vi.fn(),markItrHosted:m.hosted,pushVisitorMessageToChannel:vi.fn(),rememberQueue:vi.fn(),writeVisitorChatMessage:vi.fn()}));
vi.mock('../integrations/itr/itr-client.js',()=>({itrStart:m.start}));
import {executeRoutes} from '../modules/itr/route-exec.js';
describe('ITR fallback preserves visitor context',()=>{
 beforeEach(()=>{vi.clearAllMocks();m.vdn.mockResolvedValue(7);m.start.mockResolvedValue({result:0,state:'waiting'});m.update.mockResolvedValue({});});
 it('starts the fallback with the actual VDN, Web channel and English locale',async()=>{
  const out=await executeRoutes(77,[{id:1,appType:'itr',flowId:1017,agentId:0,robotId:0,agentGroupId:0,skillId:0,mediaType:5,linePriority:0,timeoutSeconds:0,priority:0}]);
  expect(out.ok).toBe(true);expect(m.start).toHaveBeenCalledWith(expect.objectContaining({vdnId:7,channelType:'Channel::WebWidget',meta:expect.objectContaining({locale:'en'})}));
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({additional_attributes:expect.objectContaining({locale:'en-US',department:'studio',itr_flow_id:1017,itr_hosted:true})})}));
  expect(m.hosted).toHaveBeenCalledWith(77,true);
 });
 it('does not persist a fallback when ITR refuses the session',async()=>{m.start.mockResolvedValue({result:3});await executeRoutes(77,[{id:1,appType:'itr',flowId:1017} as any]);expect(m.update).not.toHaveBeenCalled();});
});
