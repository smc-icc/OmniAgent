import { describe,it,expect } from 'vitest';
import { selectVideoRouting } from '../modules/video/video-agent-routing.js';
const entry={id:'support',label:'Video',vdnId:1,accessCode:'7099'};
const row={vdn_id:1,access_code:'7099',group_id:12,skill_id:12};
describe('video seat routing from existing authorized ICC membership',()=>{
 it('returns unique groups and skills only for configured local entries',()=>expect(selectVideoRouting([entry],1,[row,row])).toEqual({group_ids:[12],skill_ids:[12]}));
 it('rejects cross VDN rows',()=>expect(selectVideoRouting([entry],1,[{...row,vdn_id:2}])).toEqual({group_ids:[],skill_ids:[]}));
 it('rejects unconfigured access codes',()=>expect(selectVideoRouting([entry],1,[{...row,access_code:'9999'}])).toEqual({group_ids:[],skill_ids:[]}));
 it('does not invent membership for an unassigned seat',()=>expect(selectVideoRouting([entry],1,[])).toEqual({group_ids:[],skill_ids:[]}));
 it('does not leak other VDN entry groups',()=>expect(selectVideoRouting([entry],2,[row])).toEqual({group_ids:[],skill_ids:[]}));
});
